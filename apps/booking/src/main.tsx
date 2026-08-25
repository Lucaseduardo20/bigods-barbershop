import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { App } from './App';
import { BARBEARIA } from './lib/barbearia';
import { iniciarSentry } from './lib/sentry';
import './index.css';

// Antes do render: erro que acontece na primeira pintura é justamente o que
// mais interessa, e o SDK precisa estar de pé para vê-lo.
iniciarSentry();

/**
 * Tela de quando o React desiste. Sem ela o cliente vê uma página BRANCA no
 * meio da compra e vai embora — e ninguém fica sabendo. Aqui ele vê o que
 * aconteceu, tem um botão para tentar de novo e um caminho humano (WhatsApp)
 * para terminar o agendamento mesmo com o funil quebrado.
 */
function Fallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-brand)', fontSize: 22, margin: '0 0 8px' }}>
          Algo travou aqui do nosso lado
        </h1>
        <p style={{ opacity: 0.8, margin: '0 0 20px', lineHeight: 1.5 }}>
          Não foi culpa sua. Tente de novo — e se insistir, fale com a gente que agendamos por lá.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '12px 20px', borderRadius: 999, border: 0, cursor: 'pointer' }}
        >
          Tentar de novo
        </button>
        {BARBEARIA.whatsapp ? (
          <p style={{ marginTop: 16 }}>
            <a href={`https://wa.me/${BARBEARIA.whatsapp}`} style={{ color: 'inherit' }}>
              Falar no WhatsApp
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<Fallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
