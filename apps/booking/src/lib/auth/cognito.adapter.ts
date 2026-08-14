import type { ConfirmarLoginClienteResponse } from '@bigods/contracts';
import { api } from '../api';
import { COMPANY_ID } from '../config';
import { paraE164 } from '../telefone';
import type { AuthClienteAdapter, DesafioIniciado } from './index';

/**
 * EXPERIMENTO (base de teste, não é o caminho de produção): o navegador
 * autentica DIRETO no Cognito via Amplify, no fluxo CUSTOM_AUTH.
 *
 * O que muda e o que NÃO muda em relação ao adapter `api`:
 *  - muda quem ORQUESTRA o desafio: o Cognito, não a nossa API;
 *  - NÃO muda por onde o código chega: continua WhatsApp, pelo mesmo serviço
 *    Baileys de sempre — quem chama é o trigger `create-auth-challenge`
 *    (ver `infra/cognito-triggers/`), não o SNS;
 *  - NÃO muda a autorização do resto do sistema: o `idToken` do Cognito é
 *    trocado por uma sessão nossa em `/conta/login/cognito`, então
 *    `@ContaCliente()` segue sendo o único mecanismo.
 *
 * Sequência: provisionar (idempotente, na API) → signIn → confirmSignIn →
 * trocar idToken por sessão. O provisionamento existe porque o Cognito não
 * cria usuário sozinho e o navegador não tem permissão de admin para criar.
 *
 * O SDK do Amplify é carregado por `import()` dinâmico, não estático: ele
 * dobra o bundle do funil (~180kB → ~315kB), e o deploy de produção roda no
 * adapter `api`. Assim o chunk só é baixado por quem realmente liga o
 * experimento — quem não liga não paga nada por ele.
 */

interface ConfigCognito {
  userPoolId: string;
  userPoolClientId: string;
}

function lerConfig(): ConfigCognito {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
  if (!userPoolId || !userPoolClientId) {
    // Sem fallback mudo para o adapter `api`: quem ligou VITE_AUTH_ADAPTER=cognito
    // e esqueceu o pool precisa ver o erro, não um login funcionando por outro
    // caminho e mascarando a configuração incompleta.
    throw new Error(
      'VITE_AUTH_ADAPTER=cognito exige VITE_COGNITO_USER_POOL_ID e VITE_COGNITO_CLIENT_ID.',
    );
  }
  return { userPoolId, userPoolClientId };
}

type AuthDoAmplify = typeof import('aws-amplify/auth');

let carregando: Promise<AuthDoAmplify> | null = null;

/** Carrega e configura o Amplify uma única vez por sessão de navegador. */
function amplifyAuth(config: ConfigCognito): Promise<AuthDoAmplify> {
  if (!carregando) {
    carregando = (async () => {
      const [{ Amplify }, auth] = await Promise.all([
        import('aws-amplify'),
        import('aws-amplify/auth'),
      ]);
      Amplify.configure({ Auth: { Cognito: config } });
      return auth;
    })();
  }
  return carregando;
}

export function criarAdapterCognito(): AuthClienteAdapter {
  const config = lerConfig();

  return {
    nome: 'cognito',

    async iniciar(telefone: string): Promise<DesafioIniciado> {
      const { signIn, signOut } = await amplifyAuth(config);
      const username = paraE164(telefone);

      // Uma sessão pendente de outro telefone (ou de uma tentativa abandonada)
      // faz o `signIn` seguinte falhar com "already signed in". Limpar é
      // inofensivo aqui: no funil, iniciar OTP significa começar do zero.
      await signOut().catch(() => undefined);

      // Garante o usuário no User Pool antes do desafio (ver o use case
      // `ProvisionarUsuarioCognitoUseCase` no backend para o porquê).
      await api<{ ok: true }>('/conta/login/cognito/provisionar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone: username },
      });

      const { nextStep } = await signIn({
        username,
        options: { authFlowType: 'CUSTOM_WITHOUT_SRP' },
      });
      if (nextStep.signInStep !== 'CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE') {
        throw new Error(
          `Cognito não pediu o código (passo '${nextStep.signInStep}') — confira os triggers de CUSTOM_AUTH do User Pool.`,
        );
      }

      // O Amplify carrega a sessão do desafio internamente; não há token opaco
      // para a UI guardar, e `codigoDemo` nunca existe fora do provider demo.
      return { desafio: '', codigoDemo: null };
    },

    async confirmar({ codigo }): Promise<ConfirmarLoginClienteResponse> {
      const { confirmSignIn, fetchAuthSession } = await amplifyAuth(config);

      const { isSignedIn } = await confirmSignIn({ challengeResponse: codigo });
      if (!isSignedIn) {
        throw new Error('Código inválido ou expirado');
      }

      const sessao = await fetchAuthSession();
      const idToken = sessao.tokens?.idToken?.toString();
      if (!idToken) {
        throw new Error('Cognito autenticou mas não devolveu idToken');
      }

      // Troca pelo token da nossa aplicação — daqui pra frente o funil é
      // idêntico ao caminho tradicional.
      return api<ConfirmarLoginClienteResponse>('/conta/login/cognito', {
        method: 'POST',
        body: { companyId: COMPANY_ID, idToken },
      });
    },
  };
}
