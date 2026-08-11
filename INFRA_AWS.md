# Estratégia de infraestrutura na AWS — documento de decisão

> ✅ **DECIDIDO (2026-08-11):** Estratégia A, com os frontends em S3+CloudFront
> em vez de container (refinamento discutido depois da recomendação original
> abaixo) — EC2 (API + `whatsapp-otp` + Caddy) + RDS Postgres + S3/CloudFront
> (admin/booking/account). **O passo a passo completo pra criar isso está em
> [`AWS_SETUP.md`](./AWS_SETUP.md)** — este documento aqui é o raciocínio por
> trás da escolha; aquele é o runbook executável. `docker-compose.aws.yml`,
> `Caddyfile`, `scripts/deploy-frontends.sh` e `scripts/fetch-secrets-ssm.sh`
> já implementam essa topologia no repo.

Este documento existe pra **decidirmos juntos** como hospedar o Bigod's Barber
na AWS — era a base pra escolher o caminho antes de partir pra implementação.
Ele parte do que já existia (containers, `docker-compose.prod.yml`,
`scripts/deploy.sh`) e considera o que ainda vai entrar (webhook de pagamento
real, mais tráfego, etc).

**Meu recado direto, antes dos detalhes:** pra uma barbearia começando, eu
recomendo a **Estratégia A** (uma instância EC2 rodando exatamente o
`docker-compose` que já testamos, banco em RDS gerenciado). É o caminho mais
barato, mais simples de operar sozinho, e reaproveita 100% do trabalho já
feito — zero retrabalho. As Estratégias B/C ficam registradas aqui como o
caminho de crescimento, pra quando (se) fizer sentido. Motivo detalhado na
seção "Recomendação".

---

## 1. O que existe hoje (e o que isso implica pra AWS)

| Componente | Natureza | Implicação pra hospedagem |
|---|---|---|
| `apps/api` (NestJS) | **Sem estado** — tudo vive no Postgres | Roda bem em qualquer computo: EC2, ECS/Fargate, App Runner. Escala horizontal sem drama. |
| `apps/admin`, `apps/booking`, `apps/account` | 3 SPAs (Vite), build 100% estático | Candidatos naturais a S3+CloudFront — não precisam de servidor rodando 24h. |
| `services/whatsapp-otp` (Baileys) | **Só pode ter UMA instância** — sessão do WhatsApp é vinculada a um único processo; rodar 2 ao mesmo tempo derruba a sessão. Precisa de disco persistente (credenciais da sessão) e ficar sempre no ar (WebSocket permanente com os servidores do WhatsApp). | **Este é o componente que não se comporta como "nuvem moderna descartável".** É um "pet", não "gado" — não faz sentido em Fargate com auto-scaling, não pode ter 2 réplicas. Guia toda a decisão de arquitetura (ver §3). |
| Postgres | Dado real do negócio | RDS gerenciado (backup automático, point-in-time recovery) — não vale rodar Postgres "na mão" em produção mesmo que seja tecnicamente possível. |
| Webhook do AbacatePay (`POST /webhooks/abacatepay`) | **Ainda desligado** (`PAYMENT_GATEWAY=fake`) mas vai ligar — nesse momento precisa de HTTPS público, domínio estável, e o segredo de assinatura (`ABACATEPAY_WEBHOOK_SECRET`) já validado no boot (`assertConfiguracaoSegura` recusa subir sem ele) | Qualquer que seja a escolha, a API PRECISA estar atrás de um domínio HTTPS público e estável — não dá pra esconder atrás de VPN/IP privado. |
| 5 Dockerfiles + `docker-compose.prod.yml` + `scripts/deploy.sh` | **Já existe, já testado nesta sessão** — builda as 5 imagens, roda migration, healthcheck, tudo num comando | Isso é o maior ativo pra essa decisão: as mesmas imagens Docker rodam IDÊNTICAS numa EC2, num ECS/Fargate, ou num App Runner. A escolha de "onde rodar" não exige recontainerizar nada. |
| Boot-guard de produção (`assertConfiguracaoSegura`) | Já recusa subir com config insegura (`DEMO_MODE` em prod, provider errado, gateway sem chave) | Funciona igual em qualquer hospedagem — não depende da AWS. |

**O ponto central desta decisão:** `services/whatsapp-otp` é fundamentalmente
diferente dos outros 4 componentes — é o único que precisa de identidade fixa
(um processo, um disco, sempre o mesmo). Isso elimina de cara os caminhos
"tudo serverless"/"tudo auto-scaling" como solução única — ou aceitamos essa
exceção com uma solução dedicada pra ela, ou complicamos a arquitetura tentando
forçá-la num molde que não serve.

---

## 2. Mapeamento componente → serviço AWS

| Componente | Estratégia A (recomendada agora) | Estratégia B (cloud-native) | Estratégia C (híbrida) |
|---|---|---|---|
| `apps/api` | EC2 (Docker Compose) | ECS Fargate atrás de ALB | App Runner |
| `services/whatsapp-otp` | EC2 (mesma instância, Docker Compose) | ECS Fargate + volume EFS | EC2/Lightsail dedicada (só pra este serviço) |
| `admin`/`booking`/`account` | **S3 + CloudFront** (refinado — ver nota no topo do documento; elimina o `docker/static-server` da produção) | S3 + CloudFront | S3 + CloudFront |
| Postgres | **RDS Postgres** (todas as 3 estratégias) | RDS Postgres | RDS Postgres |
| Segredos | SSM Parameter Store (SecureString) | SSM Parameter Store ou Secrets Manager | SSM Parameter Store |
| TLS / domínio | Caddy (container extra, HTTPS automático) OU ALB + ACM | ALB + ACM (obrigatório com ECS) | App Runner (TLS automático) + CloudFront (TLS automático) |
| Deploy | SSH + `git pull` + `scripts/deploy.sh production` (GitHub Actions dispara isso) | GitHub Actions → build → push ECR → `ecs update-service` | GitHub Actions → ECR (api) + S3 sync (frontends) + SSH (whatsapp-otp) |

---

## 3. As três estratégias, em detalhe

### Estratégia A — Uma instância EC2 rodando o que já construímos

Sobe UMA instância EC2 (Linux, Docker instalado) e roda literalmente o
`docker-compose.yml` + `docker-compose.prod.yml` + `scripts/deploy.sh
production` que já validamos nesta sessão — a única mudança real é trocar
`DATABASE_URL` pra apontar pro RDS em vez do Postgres em container.

**Prós:**
- **Zero retrabalho** — é rodar exatamente o que já testamos, na AWS em vez
  de local.
- Mais barato de longe (ver §5).
- Um único lugar pra olhar logs/debugar (`ssh` + `docker compose logs`) —
  mesmo fluxo mental que já usamos hoje.
- `whatsapp-otp` fica trivialmente correto: é UM processo, num disco fixo,
  numa máquina fixa — exatamente o que ele quer ser. Nenhuma componentização
  extra necessária.

**Contras:**
- Ponto único de falha pro compute (não pro banco, que já está em RDS) — se a
  instância cair, API e frontends ficam fora até reiniciar (mitigável com EC2
  Auto Recovery — a AWS detecta falha de hardware e reinicia sozinha; e
  `restart: unless-stopped` nos containers já cobre crash de processo).
  `whatsapp-otp` sempre teria esse risco de qualquer forma (é um componente
  "pet" em qualquer estratégia).
  - **Escala vertical, não horizontal** — se o tráfego crescer muito, a
    resposta é trocar pra uma instância maior (t3.medium, etc), não somar
    réplicas. Pra uma barbearia, é difícil imaginar tráfego que justifique
    outra coisa nos próximos anos.
- Deploy não é "clique e pronto" como App Runner/ECS — é um script rodando via
  SSH (mas já é exatamente o `scripts/deploy.sh` de hoje, então zero curva de
  aprendizado nova).

**Quando ISSO deixa de ser suficiente:** se o volume de agendamento crescer
muito (múltiplas barbearias usando o mesmo sistema, por exemplo — fora do
escopo atual, DOMAIN.md §11), ou se a exigência de disponibilidade subir
(SLA formal, etc). Pra uma barbearia física validando o produto, não é o caso
ainda.

### Estratégia B — Cloud-native completo (ECS Fargate + S3/CloudFront)

- `api` como serviço ECS Fargate atrás de um Application Load Balancer.
- `whatsapp-otp` como TAREFA ÚNICA (não serviço com múltiplas réplicas) no
  Fargate, com um volume EFS montado em `/app/session` pra sobreviver a
  reagendamentos de tarefa.
- `admin`/`booking`/`account` publicados como arquivos estáticos em S3, atrás
  de distribuições CloudFront que fazem roteamento por caminho (`/api/*` →
  origem = o ALB da API; resto → origem = o bucket S3) — **isso elimina o
  `docker/static-server` inteiramente** nesta estratégia, já que o CloudFront
  assume o papel de proxy que o Node fazia.

**Prós:**
- Infra totalmente gerenciada — sem "servidor pra cuidar" pro `api` e pros
  frontends (o `whatsapp-otp` continua sendo a exceção, ver abaixo).
- Frontends em S3+CloudFront são extremamente baratos e rápidos (CDN global).
- Deploy da API via pipeline (build → push ECR → `ecs update-service`) sem
  SSH.

**Contras:**
- **Muito mais peças móveis** pra uma aplicação deste porte: cluster ECS,
  task definitions, ALB, target groups, ECR, EFS, IAM roles por serviço,
  CloudFront, S3 — cada uma é mais uma coisa pra configurar, entender, e
  manter (e mais uma fonte de erro de configuração).
- `whatsapp-otp` em Fargate+EFS é a parte menos natural: Fargate foi feito
  pensando em "cattle" (várias réplicas idênticas e substituíveis) e aqui
  precisamos forçar "exatamente 1 réplica, sempre a mesma identidade" — dá
  pra fazer (task definition com `desiredCount: 1`, EFS access point), mas é
  nadar contra a corrente da ferramenta.
- Custo-base bem mais alto mesmo com tráfego baixo (ALB sozinho já custa mais
  que a instância EC2 inteira da Estratégia A — ver §5).

### Estratégia C — Híbrida (App Runner pra API + EC2/Lightsail só pro whatsapp-otp)

- `api`: App Runner (dá um container, ganha TLS automático, domínio, deploy
  automático a partir do ECR/GitHub — MUITO menos configuração que ECS puro).
- `whatsapp-otp`: uma instância pequena dedicada (EC2 t4g.micro OU Lightsail,
  que é ainda mais simples de gerenciar) — reconhece que esse componente É um
  "pet" e não tenta escondê-lo atrás de Fargate/EFS.
- Frontends: S3 + CloudFront (igual à Estratégia B).
- Postgres: RDS (igual às outras duas).

**Prós:**
- Cada componente na ferramenta que combina com sua natureza — API stateless
  em algo gerenciado e simples (App Runner é bem mais simples que ECS
  Fargate puro), componente stateful numa caixa simples e dedicada.
- Frontends em CDN, baratos e rápidos.
- Menos peças que a Estratégia B (sem ALB, sem ECS cluster, sem EFS).

**Contras:**
- Ainda são 4 sistemas de deploy diferentes pra aprender/manter (App Runner +
  SSH pro EC2 do whatsapp-otp + S3 sync pros frontends + RDS) em vez de 1.
- Custo intermediário — mais que A, menos que B.

---

## 4. Recomendação

**Estratégia A agora, com dois reforços específicos:**

1. **Banco em RDS desde o início**, mesmo rodando tudo o resto numa EC2 só —
   backup automático e point-in-time recovery são baratos (RDS
   `db.t4g.micro`, ver §5) e a diferença entre "perder a instância de
   compute" (chato, mas recuperável reiniciando) e "perder o banco" (dado
   real de cliente, catastrófico) é grande demais pra economizar aqui.
2. **TLS via Caddy** (mais um container no mesmo `docker-compose`, faz HTTPS
   automático com Let's Encrypt) em vez de ALB — evita o custo fixo do ALB
   (~$16-20/mês só de existir, ver §5) numa fase em que uma instância só já dá
   conta do tráfego. Se um dia quisermos redundância de compute, essa é a
   primeira peça a trocar por um ALB de verdade.

**Por quê, no fundo:** o maior risco real de uma barbearia pequena não é
"será que a AWS vai escalar" — é "será que alguém consegue operar isso
sozinho quando eu não estiver por perto". A Estratégia A tem literalmente 1
lugar pra olhar quando algo quebra, reaproveita todo o trabalho de
containerização já validado, e custa uma fração do resto. Migrar pra B/C
depois é possível — as imagens Docker já são as mesmas, só muda ONDE rodam.

**Quando reconsiderar:** se o negócio decidir atender múltiplas barbearias
(fora do escopo hoje, DOMAIN.md §11) ou se o tráfego real justificar,
migrar primeiro a API pra App Runner (Estratégia C) é o próximo passo mais
natural — ela é stateless e não exige mudar nada no código, só onde ela roda.
Deixaria o `whatsapp-otp` na mesma EC2 (ele nunca precisa de mais que isso).

---

## 5. Estimativa de custo mensal (aproximada — confirme na calculadora oficial da AWS antes de decidir)

Region assumida: **sa-east-1 (São Paulo)** — menor latência pro Brasil, mas
tende a ser mais cara que us-east-1 em alguns serviços (NAT Gateway, por
exemplo). Valores em USD, arredondados.

| Item | Estratégia A | Estratégia B | Estratégia C |
|---|---|---|---|
| Compute API | incluso na EC2 abaixo | ECS Fargate (~0.25 vCPU/0.5GB, sempre ligado): ~US$ 10-15 | App Runner (~0.25 vCPU/0.5GB): ~US$ 12-18 |
| Compute whatsapp-otp | incluso na EC2 abaixo | Fargate + EFS: ~US$ 10-15 + ~US$ 1-3 (EFS, poucos MB) | EC2/Lightsail t4g.micro: ~US$ 7-10 |
| EC2 (API + whatsapp-otp + frontends juntos) | t4g.small (2 vCPU, 2GB): ~US$ 15-20 | — | — |
| Frontends | incluso na EC2 acima | S3 + CloudFront: ~US$ 1-3 (tráfego baixo) | ~US$ 1-3 |
| Postgres | RDS db.t4g.micro + 20GB gp3: ~US$ 15-20 | igual | igual |
| Load balancer / TLS | Caddy: **US$ 0 extra** (ou ALB: ~US$ 18-25) | ALB: ~US$ 18-25 (obrigatório) | App Runner/CloudFront: TLS incluso |
| NAT Gateway | **evitável** (ver §6 — sem subnet privada pra 1 instância só) | ~US$ 33-65 SE usado (evitável com o mesmo truque) | ~US$ 33-65 SE usado (evitável) |
| **Total aproximado/mês** | **~US$ 30-40** (com Caddy) / ~US$ 50-65 (com ALB) | **~US$ 60-100+** | **~US$ 40-60** |

Não incluí: transferência de dados (baixa nesse volume), Route53
(~US$ 0,50/zona/mês + queries, irrisório), backups extras, CloudWatch (free
tier cobre o básico). NAT Gateway é o item mais fácil de virar um custo
surpresa "escondido" — por isso está detalhado à parte no §6.

---

## 6. Rede: como evitar o NAT Gateway sem abrir mão de segurança

Um VPC "de livro" põe tudo que não é balanceador em subnet PRIVADA, e usa um
NAT Gateway pra essas coisas conseguirem sair pra internet (o `whatsapp-otp`
precisa de saída pra internet pra falar com os servidores do WhatsApp; a API
precisa de saída pra falar com o AbacatePay). O NAT Gateway é caro pro
tamanho deste projeto (~US$ 33-65/mês só de existir, ver §5).

**Alternativa mais barata, ainda razoavelmente segura pra este porte:** subnet
PÚBLICA pra instância única, mas com **Security Group travado** — só as
portas 80/443 (ou as portas dos serviços expostos) abertas de entrada, vindas
de qualquer lugar (ou, melhor, só do Caddy/ALB); todo o resto (Postgres na
RDS, porta interna do `whatsapp-otp`) SEM porta de entrada nenhuma pública —
mesmo estando em subnet pública, nada alcança essas portas de fora sem a
regra do Security Group permitir. Isso dá o mesmo resultado prático de
isolamento que uma subnet privada, sem pagar o NAT Gateway — o preço é uma
camada a menos de defesa-em-profundidade (rede vs. regra de firewall), que
pra este porte de aplicação é uma troca razoável.

RDS continua em subnet privada (não precisa de saída pra internet, só recebe
conexão da EC2 — isso não exige NAT, só as regras corretas de Security
Group).

---

## 7. Segredos

Nenhuma credencial (`AUTH_SECRET`, `WHATSAPP_OTP_INTERNAL_TOKEN`,
`DATABASE_URL`, `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`) deve viver
em texto puro no `.env` da instância em produção além do mínimo necessário
pro processo ler em runtime. Recomendo **SSM Parameter Store** (tipo
`SecureString`) em vez de Secrets Manager — funcionalmente equivalente pro
nosso caso (não precisamos de rotação automática), e **Parameter Store é
gratuito** (Secrets Manager cobre ~US$ 0,40/segredo/mês, pequeno mas
desnecessário aqui). Um script de start puxa os parâmetros do SSM e escreve o
`.env` no boot da instância (ou usa `aws ssm get-parameters` diretamente no
`scripts/deploy.sh`).

## 8. Domínio, TLS, DNS

- Domínio único, subdomínios por app (padrão já usado no código via
  `VITE_BOOKING_URL`): ex. `admin.suabarbearia.com`, `agendar.suabarbearia.com`
  (booking), `conta.suabarbearia.com` (account), `api.suabarbearia.com`.
- Route53 como DNS (ou o registrador que já tiver, apontando pro Route53 ou
  direto pro IP/ALB).
- TLS: Caddy (Estratégia A) faz Let's Encrypt automático por domínio — só
  precisa dos registros DNS apontados antes de subir. ACM (Estratégias B/C)
  é o equivalente gerenciado pela AWS, integrado a ALB/CloudFront/App Runner.

## 9. CI/CD

Proposta mínima pra Estratégia A (a mais simples de implementar):
GitHub Actions, no merge pra `main`, faz SSH na instância e roda:
```
git pull && scripts/deploy.sh production --pull
```
(o `--pull` já existe no script, ver `DEPLOY.md`). Não precisa de ECR nem
pipeline de build separado — a imagem é buildada NA instância, exatamente
como testamos localmente. Trade-off: o build acontece na própria instância de
produção (usa CPU/memória por alguns minutos durante o deploy) — aceitável
pro tamanho do projeto; se incomodar, a evolução natural é buildar num
runner do GitHub Actions e só copiar as imagens prontas.

## 10. Backups e observabilidade

- **RDS:** snapshot automático diário (retenção configurável, ex. 7 dias) —
  nativo do RDS, só habilitar.
- **Sessão do `whatsapp-otp`:** perder o disco = precisar escanear o QR de
  novo (chato, não catastrófico — nenhum dado de cliente mora ali). Ainda
  assim, vale um snapshot do volume EBS (ou sync periódico da pasta de sessão
  pro S3) pra não precisar reconectar à toa numa manutenção de rotina.
- **Alerta básico:** um CloudWatch Alarm simples batendo em `GET
  /public/empresa?companyId=...` (API) e `GET /status` (`whatsapp-otp`) a
  cada alguns minutos, notificando por SNS→e-mail se cair — não existe hoje,
  vale como próximo passo depois da infra estar no ar, não bloqueia o
  lançamento.

---

## 11. Decisões que precisam da sua palavra final

1. **Confirma a Estratégia A** (EC2 + RDS + Caddy) como ponto de partida, ou
   prefere já ir de Estratégia C (App Runner + EC2 dedicada pro whatsapp-otp)
   pelo TLS/deploy gerenciados, aceitando o custo um pouco maior?
2. **Domínio:** já existe um domínio registrado pra barbearia, ou precisa
   comprar um (Route53 registra, ou traz de outro registrador)?
3. **Região:** confirma `sa-east-1` (São Paulo) — melhor latência pro Brasil
   — ou prefere `us-east-1` (mais barato em alguns serviços, latência maior)?
4. **Staging na AWS ou só local?** Hoje `scripts/deploy.sh staging` já roda
   local/em qualquer máquina — dá pra continuar usando isso pra testar antes
   de ir pra produção, sem precisar de uma segunda EC2/RDS só pra staging
   (economiza o dobro do custo mensal). Só vale um staging na nuvem se quiser
   testar em condições de rede/domínio reais antes do deploy final.
5. **Orçamento mensal alvo?** Ajuda a confirmar se ~US$ 30-40/mês (Estratégia
   A) está confortável ou se há margem pra mais.
