import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { iniciarSentry } from './lib/sentry';
import './index.css';

// Antes do render: erro que acontece na primeira pintura é justamente o que
// mais interessa, e o SDK precisa estar de pé para vê-lo.
iniciarSentry();

/** Tela de quando o React desiste — melhor que a página branca. */
function Fallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-brand)', fontSize: 22, margin: '0 0 8px' }}>
          Algo quebrou no painel
        </h1>
        <p style={{ opacity: 0.8, margin: '0 0 20px', lineHeight: 1.5 }}>
          Recarregue a página. Se continuar, o erro já foi reportado — nada do que você fez se perdeu.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ padding: '12px 20px', borderRadius: 999, border: 0, cursor: 'pointer' }}
        >
          Recarregar
        </button>
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
