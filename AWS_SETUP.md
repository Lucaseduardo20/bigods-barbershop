# AWS_SETUP.md — Runbook completo: criar a infra do zero

Passo a passo executável pra criar a arquitetura decidida em `INFRA_AWS.md`:
**EC2** (API + `whatsapp-otp` + Caddy) + **RDS** (Postgres) + **S3+CloudFront**
(admin/booking/account). Cada fase tem um checkpoint pra confirmar que deu
certo antes de ir pra próxima.

> ## Fazendo tudo pelo Console — leia isto primeiro
>
> Dá pra fazer o runbook inteiro **sem instalar nada na sua máquina**, direto
> pelo navegador, usando o **AWS CloudShell**: dentro do Console (depois de
> logado), clique no ícone de terminal `>_` no topo da página (barra superior,
> perto do sino de notificações). Abre um terminal Linux, no navegador, **já
> autenticado com a sua sessão** — sem chave de acesso pra gerenciar, sem
> instalar AWS CLI, sem configurar nada. Todos os blocos de comando deste
> runbook (`aws ec2 ...`, `aws rds ...` etc.) são pra colar **ali dentro**.
> É literalmente "fazer pelo console" — só que colando comandos em vez de
> clicar em formulários, o que é bem mais confiável pra recursos com muitos
> campos (VPC, Security Group, IAM) do que eu tentar descrever exatamente
> onde cada botão fica (a AWS muda a posição das coisas com frequência, e eu
> não tenho como ver a tela atual do seu Console pra confirmar).
>
> Pra 3 pontos específicos — **registrar o domínio**, **criar a distribuição
> CloudFront**, e **lançar a instância EC2** — vale mesmo usar os
> assistentes visuais do Console em vez de CLI, e eu descrevo os CAMPOS a
> preencher (não posições de botão) nessas seções. O resto (rede, RDS,
> segredos, IAM) é mais rápido e confiável colando os comandos no CloudShell.

**Region usada nos exemplos: `sa-east-1` (São Paulo).** Troque se decidiu
outra (ver `INFRA_AWS.md` §11).

---

## Fase 0 — Conta, domínio e pré-requisitos

### 0.1 — Conta e usuário IAM

Se ainda não tem: crie a conta AWS (cartão de crédito, e-mail) em
[aws.amazon.com](https://aws.amazon.com). **Não use a conta root no dia a
dia** — no Console, vá em **IAM → Usuários → Criar usuário**, dê um nome
(ex.: `voce-admin`), marque "Fornecer acesso ao Console" (senha própria), e
em permissões escolha **Anexar políticas diretamente** → `AdministratorAccess`
(só pra esta configuração inicial — dá pra restringir depois). Saia da conta
root e entre com esse usuário novo daqui pra frente.

### 0.2 — Domínio: como conseguir um

Você ainda não tem — duas estratégias, e dá pra decidir aqui mesmo:

**A) Registrar um domínio de verdade agora (recomendado)** — vai precisar
dele de qualquer forma pra produção de verdade, custa pouco (~US$10-15/ano
pra um `.com`), e registrando pelo **Route53** o DNS já fica integrado, sem
passo extra de apontar name servers pra outro provedor.
No Console: **Route53 → Domínios registrados → Registrar domínio** →
digite o nome desejado (ex.: `suabarbearia.com`) → confirma disponibilidade
→ preenche os dados de contato (exigido pela ICANN, mesmo com privacidade de
WHOIS ativada, que já vem de graça) → paga. Leva de alguns minutos a ~1h pra
ficar ativo (às vezes até 24h pra alguns TLDs). **Enquanto isso não
finaliza, dá pra continuar as Fases 1-5 deste runbook** — só a Fase 6 em
diante (DNS/certificado) depende do domínio já estar pronto.

**B) Testar hoje sem gastar com domínio (`sslip.io`)** — serviço gratuito de
DNS "mágico" que resolve `<qualquer-coisa>.<IP>.sslip.io` pro próprio IP
automaticamente, sem cadastro nenhum. Deixa validar a arquitetura INTEIRA
hoje, com HTTPS de verdade (o Caddy consegue certificado Let's Encrypt pra
domínios `sslip.io` normalmente), e trocar pelo domínio de verdade depois
(troca só `API_DOMAIN` no `.env` e reinicia o Caddy — nenhuma outra mudança).
Ex.: se sua EC2 tiver IP `18.230.10.5`, seu `API_DOMAIN` vira
`api.18-230-10-5.sslip.io` (troque pontos por hífen no IP).

**Minha recomendação:** se o nome da barbearia já está decidido, vai de A —
é barato e você já sai com o de verdade. Se ainda está testando/decidindo o
nome do negócio, vai de B hoje e registra o domínio quando decidir.

### 0.3 — Variáveis do runbook

Cole isto no CloudShell (ou no seu terminal, se preferir CLI local) —
**todo o resto do runbook usa essas variáveis**:

```bash
export AWS_REGION="us-east-1"
export PROJETO="bigods"
export DOMINIO_BASE="bigodsbarbershop.com"
export API_DOMAIN="api.${DOMINIO_BASE}"
export DB_SENHA="$(openssl rand -base64 50 | tr -d '=+/')"
export AUTH_SECRET_VALOR="$(openssl rand -hex 32)"
export WHATSAPP_TOKEN_VALOR="$(openssl rand -hex 32)"
```

Se estiver usando CLI local em vez de CloudShell, confirme antes:
`aws configure` (Access Key do usuário IAM criado em 0.1, região `sa-east-1`,
formato `json`). No CloudShell isso já vem pronto, pule direto pras variáveis.

---

## Fase 1 — Rede (VPC, subnets, security groups)

Uma VPC simples: 2 subnets **públicas** (em AZs diferentes — obrigatório pro
RDS mesmo sem Multi-AZ) e nenhum NAT Gateway (decisão de custo, ver
`INFRA_AWS.md` §6 — o isolamento vem do Security Group, não da topologia de
rede).

```bash
# VPC
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${PROJETO}-vpc}]" \
  --query 'Vpc.VpcId' --output text)
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames

# Internet Gateway
IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PROJETO}-igw}]" \
  --query 'InternetGateway.InternetGatewayId' --output text)
aws ec2 attach-internet-gateway --vpc-id "$VPC_ID" --internet-gateway-id "$IGW_ID"

# 2 subnets públicas, AZs diferentes
AZ1="${AWS_REGION}a"
AZ2="${AWS_REGION}b"
SUBNET_A=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.20.1.0/24 \
  --availability-zone "$AZ1" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJETO}-subnet-a}]" \
  --query 'Subnet.SubnetId' --output text)
SUBNET_B=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.20.2.0/24 \
  --availability-zone "$AZ2" \
  --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJETO}-subnet-b}]" \
  --query 'Subnet.SubnetId' --output text)

# Tabela de rotas: 0.0.0.0/0 → Internet Gateway, associada às 2 subnets
RTB_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJETO}-rtb}]" \
  --query 'RouteTable.RouteTableId' --output text)
aws ec2 create-route --route-table-id "$RTB_ID" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID"
aws ec2 associate-route-table --route-table-id "$RTB_ID" --subnet-id "$SUBNET_A"
aws ec2 associate-route-table --route-table-id "$RTB_ID" --subnet-id "$SUBNET_B"
# Subnets recebem IP público automaticamente ao lançar instância nelas
aws ec2 modify-subnet-attribute --subnet-id "$SUBNET_A" --map-public-ip-on-launch
aws ec2 modify-subnet-attribute --subnet-id "$SUBNET_B" --map-public-ip-on-launch

echo "VPC=$VPC_ID SUBNET_A=$SUBNET_A SUBNET_B=$SUBNET_B"
```

**Security Groups** — um pra EC2 (só 22/80/443 de entrada), um pra RDS (só
5432, e só a partir do SG da EC2 — nunca aberto pra internet):

> ⚠️ **Se você está rodando isto no CloudShell:** `curl -s ifconfig.me` vai
> pegar o IP do CloudShell (da própria AWS), não o do SEU computador — o que
> é ótimo pra continuar usando o CloudShell como terminal SSH depois, mas
> significa que **dar SSH do SEU laptop vai ser bloqueado** até você liberar
> o IP dele também. Depois de rodar o bloco abaixo, rode de novo trocando
> `$(curl -s ifconfig.me)` pelo IP real da sua máquina (ex.: busque "qual meu
> IP" no navegador do seu computador, não no CloudShell) — ou simplesmente
> continue usando o CloudShell como terminal pra tudo (inclusive o SSH da
> Fase 7), sem precisar liberar mais nada.

```bash
SG_EC2=$(aws ec2 create-security-group --group-name "${PROJETO}-ec2-sg" \
  --description "EC2: API + whatsapp-otp + Caddy" --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_EC2" --protocol tcp --port 22 --cidr "$(curl -s ifconfig.me)/32"  # SSH só do IP de onde você rodou este comando
aws ec2 authorize-security-group-ingress --group-id "$SG_EC2" --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG_EC2" --protocol tcp --port 443 --cidr 0.0.0.0/0

SG_RDS=$(aws ec2 create-security-group --group-name "${PROJETO}-rds-sg" \
  --description "RDS Postgres — só a partir da EC2" --vpc-id "$VPC_ID" \
  --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" --protocol tcp --port 5432 --source-group "$SG_EC2"

echo "SG_EC2=$SG_EC2 SG_RDS=$SG_RDS"
```

> Seu IP muda (rede residencial, 4G etc.) e a porta 22 parar de responder
> depois? É isso — rode de novo o `authorize-security-group-ingress` da 22
> com o IP novo (ou revogue o antigo com `revoke-security-group-ingress`
> primeiro).

**Checkpoint:** `aws ec2 describe-vpcs --vpc-ids "$VPC_ID"` devolve a VPC.

---

## Fase 2 — Banco (RDS Postgres)

> Prefere o assistente visual? **RDS → Criar banco de dados** → Standard
> create → PostgreSQL 16 → Templates: **Dev/Test** (não "Production", que já
> vem com Multi-AZ mais caro) → Instance: `db.t4g.micro` → Storage: 20GB gp3
> → em Connectivity escolha a VPC/subnet group/security group criados na
> Fase 1 (`${PROJETO}-vpc`, `${PROJETO}-db-subnet`, `${PROJETO}-rds-sg`) →
> **Public access: No** → Initial database name: `bigods`. Os comandos abaixo
> fazem a mesma coisa no CloudShell, mais rápido:

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name "${PROJETO}-db-subnet" \
  --db-subnet-group-description "Subnets pro RDS" \
  --subnet-ids "$SUBNET_A" "$SUBNET_B"

aws rds create-db-instance \
  --db-instance-identifier "${PROJETO}-db" \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username bigods \
  --master-user-password "$DB_SENHA" \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-subnet-group-name "${PROJETO}-db-subnet" \
  --vpc-security-group-ids "$SG_RDS" \
  --backup-retention-period 7 \
  --no-multi-az \
  --no-publicly-accessible \
  --db-name bigods
```

Isso demora uns 5-10 minutos. Espera ficar disponível:

```bash
aws rds wait db-instance-available --db-instance-identifier "${PROJETO}-db"

DB_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier "${PROJETO}-db" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "DB_ENDPOINT=$DB_ENDPOINT"

export DATABASE_URL="postgresql://bigods:${DB_SENHA}@${DB_ENDPOINT}:5432/bigods"
```

**Checkpoint:** `aws rds describe-db-instances --db-instance-identifier "${PROJETO}-db" --query 'DBInstances[0].DBInstanceStatus'` devolve `"available"`.

---

## Fase 3 — Segredos (SSM Parameter Store)

```bash
SSM_PREFIX="/${PROJETO}/prod"

aws ssm put-parameter --name "${SSM_PREFIX}/AUTH_SECRET" --type SecureString --value "$AUTH_SECRET_VALOR" --overwrite
aws ssm put-parameter --name "${SSM_PREFIX}/WHATSAPP_OTP_INTERNAL_TOKEN" --type SecureString --value "$WHATSAPP_TOKEN_VALOR" --overwrite
aws ssm put-parameter --name "${SSM_PREFIX}/DATABASE_URL" --type SecureString --value "$DATABASE_URL" --overwrite
```

(`ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET` só quando decidir ligar o
pagamento online — mesmo comando, mesmo prefixo, `scripts/fetch-secrets-ssm.sh`
já busca os dois se existirem.)

**Checkpoint:** `aws ssm get-parameter --name "${SSM_PREFIX}/AUTH_SECRET" --with-decryption --query 'Parameter.Value' --output text` devolve o valor.

---

## Fase 4 — IAM Role da EC2 (acesso ao SSM, sem chave fixa)

A instância acessa o SSM Parameter Store via **IAM Role** (não uma access key
gravada na máquina — mais seguro, e é assim que `scripts/fetch-secrets-ssm.sh`
espera funcionar):

```bash
cat > /tmp/trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ec2.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF
aws iam create-role --role-name "${PROJETO}-ec2-role" --assume-role-policy-document file:///tmp/trust-policy.json

cat > /tmp/ssm-read-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ssm:GetParameter", "ssm:GetParameters"],
    "Resource": "arn:aws:ssm:${AWS_REGION}:*:parameter${SSM_PREFIX}/*"
  }]
}
EOF
aws iam put-role-policy --role-name "${PROJETO}-ec2-role" --policy-name ssm-read \
  --policy-document file:///tmp/ssm-read-policy.json

aws iam create-instance-profile --instance-profile-name "${PROJETO}-ec2-profile"
aws iam add-role-to-instance-profile --instance-profile-name "${PROJETO}-ec2-profile" --role-name "${PROJETO}-ec2-role"
```

**Checkpoint:** `aws iam get-instance-profile --instance-profile-name "${PROJETO}-ec2-profile"` devolve o perfil com a role anexada.

---

## Fase 5 — EC2 (a instância que roda API + whatsapp-otp + Caddy)

> Prefere o assistente visual? **EC2 → Instâncias → Executar instância** →
> nome `${PROJETO}-app` → AMI: busque "Debian 12" (arquitetura **arm64**,
> combinando com o tipo de instância abaixo — é o erro mais comum aqui) →
> Tipo de instância: `t4g.small` → Par de chaves: crie um novo (RSA, .pem) →
> Configurações de rede: a VPC/subnet/security group da Fase 1 → Storage:
> 30GB gp3 → em "Avançado", cole o script de `user-data` abaixo → em
> "Perfil de instância IAM" (dentro de Avançado), selecione
> `${PROJETO}-ec2-profile` (criado na Fase 4). Os comandos fazem tudo isso
> junto, mais rápido:

```bash
# Key pair pro SSH (guarda o .pem com segurança — perdeu, perdeu acesso SSH)
aws ec2 create-key-pair --key-name "${PROJETO}-key" --query 'KeyMaterial' --output text > ~/.ssh/${PROJETO}-key.pem
chmod 400 ~/.ssh/${PROJETO}-key.pem

# AMI Debian 12 mais recente, arquitetura ARM64 — TEM que bater com o tipo de
# instância (t4g.* é Graviton/ARM; se trocar pra um tipo x86 como t3.small,
# troque o filtro abaixo pra "debian-12-amd64-*", senão a instância não sobe).
AMI_ID=$(aws ec2 describe-images --owners 136693071363 \
  --filters "Name=name,Values=debian-12-arm64-*" "Name=state,Values=available" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
```

`user-data` instala Docker sozinho no primeiro boot (você não precisa entrar
na máquina pra isso):

```bash
cat > /tmp/user-data.sh <<'EOF'
#!/bin/bash
set -e
apt-get update
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker admin || true
EOF

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type t4g.small \
  --key-name "${PROJETO}-key" \
  --subnet-id "$SUBNET_A" \
  --security-group-ids "$SG_EC2" \
  --iam-instance-profile "Name=${PROJETO}-ec2-profile" \
  --user-data file:///tmp/user-data.sh \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJETO}-app}]" \
  --query 'Instances[0].InstanceId' --output text)

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# IP fixo (Elastic IP) — sem isso o IP muda se a instância reiniciar
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID"
EIP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)

echo "INSTANCE_ID=$INSTANCE_ID"
echo "EIP=$EIP  ← aponte API_DOMAIN pra este IP no seu DNS AGORA (fase 6 explica)"
```

> **Se você está no CloudShell:** o `.pem` foi salvo DENTRO do CloudShell, não
> no seu computador — precisa baixá-lo antes de conseguir dar SSH da sua
> máquina (Fase 7). No CloudShell, menu **Ações → Fazer download do
> arquivo** → digite o caminho (`/home/cloudshell-user/.ssh/${PROJETO}-key.pem`)
> → salva na sua máquina → depois `chmod 400` nele localmente também.

**Checkpoint:** espera ~1-2min o `user-data` terminar, depois:

```bash
ssh -i ~/.ssh/${PROJETO}-key.pem admin@$EIP docker --version
```

Se responder a versão do Docker, a instância está pronta.

---

## Fase 6 — DNS da API (antes de subir o Caddy — TLS depende disso)

No Route53 (ou no seu registrador, se o DNS não estiver na AWS), crie um
registro **A** de `api.${DOMINIO_BASE}` apontando pro `$EIP` acima.

Se o domínio já estiver numa Hosted Zone do Route53:

```bash
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMINIO_BASE" \
  --query 'HostedZones[0].Id' --output text | sed 's|/hostedzone/||')

cat > /tmp/dns-api.json <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "${API_DOMAIN}",
      "Type": "A",
      "TTL": 300,
      "ResourceRecords": [{"Value": "${EIP}"}]
    }
  }]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file:///tmp/dns-api.json
```

**Checkpoint:** `dig +short api.${DOMINIO_BASE}` devolve o `$EIP` (pode levar
alguns minutos pra propagar).

---

## Fase 7 — Deploy da aplicação (API + whatsapp-otp + Caddy)

```bash
ssh -i ~/.ssh/${PROJETO}-key.pem admin@$EIP
```

Já dentro da instância:

```bash
git clone <url-do-seu-repo> bigods-barber-v2
cd bigods-barber-v2

cp .env.aws.example .env
# edita API_DOMAIN e ACME_EMAIL no .env (os únicos valores não-secretos que faltam)
nano .env

./scripts/fetch-secrets-ssm.sh   # busca AUTH_SECRET/DATABASE_URL/WHATSAPP_OTP_INTERNAL_TOKEN do SSM
./scripts/deploy.sh production   # builda e sobe api + whatsapp-otp + caddy
```

Na primeira vez, o `whatsapp-otp` pede QR — noutro terminal, sem sair do SSH:

```bash
./scripts/deploy.sh production logs whatsapp-otp
```

Escaneie com o número descartável (nunca o oficial — ver
`services/whatsapp-otp/README.md`).

**Checkpoint:** `curl -s https://${API_DOMAIN}/public/empresa?companyId=bigods`
devolve JSON (não erro de certificado, não timeout). Se o Caddy ainda não
emitiu o certificado, espera 1-2 min e tenta de novo (`docker compose -f
docker-compose.aws.yml logs caddy` mostra o progresso).

---

## Fase 8 — Frontends (S3 + CloudFront)

Um bucket + uma distribuição CloudFront por app. O exemplo abaixo faz o
`admin` — repita pra `booking` e `account` trocando o nome.

### 8.1 — Bucket S3 (privado — CloudFront acessa via Origin Access Control, nunca público direto)

```bash
BUCKET_ADMIN="${PROJETO}-admin-$(date +%s)"   # nome globalmente único
aws s3api create-bucket --bucket "$BUCKET_ADMIN" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-public-access-block --bucket "$BUCKET_ADMIN" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 8.2 — Certificado TLS (ACM — **TEM que ser em us-east-1**, exigência do CloudFront, mesmo hospedando tudo em sa-east-1)

```bash
CERT_ARN=$(aws acm request-certificate \
  --domain-name "admin.${DOMINIO_BASE}" \
  --validation-method DNS \
  --region us-east-1 \
  --query 'CertificateArn' --output text)

# Pega o registro CNAME de validação e cria no Route53 (repete pro booking/account)
aws acm describe-certificate --certificate-arn "$CERT_ARN" --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
# → cria esse CNAME no Route53 (mesmo padrão da Fase 6, Type=CNAME).
# Depois de criado, espera validar:
aws acm wait certificate-validated --certificate-arn "$CERT_ARN" --region us-east-1
```

### 8.3 — Distribuição CloudFront

A configuração completa de uma distribuição via CLI é um JSON grande — **esta
é a única etapa onde o Console da AWS é genuinamente mais simples** que o
CLI pra quem está fazendo isso pela primeira vez (assistente guiado: origem =
o bucket S3 com "Origin access control", certificado = o que você acabou de
validar, domínio alternativo = `admin.suabarbearia.com`, redirecionar HTTP
pra HTTPS, "Default root object" = `index.html`). Se preferir CLI mesmo
assim, a AWS documenta o JSON completo de `create-distribution` — o ponto
que mais gente erra é esquecer o **Origin Access Control** (sem ele, ou o
bucket precisa ser público, o que não queremos, ou o CloudFront não consegue
ler os arquivos).

**Depois de criar** (console ou CLI), anote o `Distribution Id` e o domínio
`*.cloudfront.net` — e crie o registro DNS:

```bash
CF_DOMAIN="<o-que-o-cloudfront-te-deu>.cloudfront.net"
cat > /tmp/dns-admin.json <<EOF
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "admin.${DOMINIO_BASE}",
      "Type": "CNAME",
      "TTL": 300,
      "ResourceRecords": [{"Value": "${CF_DOMAIN}"}]
    }
  }]
}
EOF
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file:///tmp/dns-admin.json
```

Repita 8.1-8.3 pra `booking.${DOMINIO_BASE}` e `account.${DOMINIO_BASE}`.

### 8.4 — Publicar o conteúdo

No seu computador (não na EC2):

```bash
cp .env.frontends.example .env.frontends
# preenche VITE_API_URL=https://api.suabarbearia.com, VITE_BOOKING_URL=https://agendar...,
# e os 3 pares BUCKET/CLOUDFRONT_ID que você acabou de criar
scripts/deploy-frontends.sh
```

**Checkpoint:** `https://admin.${DOMINIO_BASE}` (e os outros 2) abrem no
navegador, sem erro de certificado, e a tela de login do painel aparece.

---

## Fase 9 — Verificação final

- [ ] `https://api.${DOMINIO_BASE}/public/empresa?companyId=bigods` → JSON
- [ ] `https://admin.${DOMINIO_BASE}` → tela de login do painel
- [ ] `https://agendar.${DOMINIO_BASE}` (booking) → funil público
- [ ] `https://conta.${DOMINIO_BASE}` (account) → login OTP do cliente
- [ ] Login OTP de teste completo (código chega no WhatsApp de verdade)
- [ ] `scripts/deploy.sh production status` → `api`, `whatsapp-otp`, `caddy` todos `Up`
- [ ] RDS com backup automático confirmado: `aws rds describe-db-instances --db-instance-identifier ${PROJETO}-db --query 'DBInstances[0].BackupRetentionPeriod'` → `7`

## Guardar em local seguro (fora deste terminal)

- `$DB_SENHA` (senha do RDS)
- `~/.ssh/${PROJETO}-key.pem` (chave SSH da EC2)
- Os valores de `$AUTH_SECRET_VALOR`/`$WHATSAPP_TOKEN_VALOR` já estão no SSM —
  não precisa guardar de novo, mas documente ONDE estão (`${SSM_PREFIX}/*`)
  pra alguém no futuro conseguir achar.

## Próximos passos (não bloqueiam o lançamento)

- CI/CD: GitHub Actions rodando `ssh ... "cd bigods-barber-v2 && scripts/deploy.sh production --pull"`
  no merge pra `main`, e um job separado rodando `scripts/deploy-frontends.sh`
  quando mudar algo em `apps/admin|booking|account`.
- CloudWatch Alarm simples batendo em `/public/empresa` e `/status` a cada
  poucos minutos, com SNS→e-mail se cair.
- Revisar o usuário IAM usado pra rodar este runbook — depois de tudo criado,
  não precisa mais de permissão de administrador; um usuário com permissão só
  de leitura/monitoramento é suficiente pro dia a dia.
