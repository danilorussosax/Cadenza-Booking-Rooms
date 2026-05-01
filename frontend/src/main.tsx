import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import App from './App';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Toaster } from '@/components/ui/sonner';
import { CookieBanner } from '@/components/legal/CookieBanner';
import { InstallPwaPrompt } from '@/components/pwa/InstallPwaPrompt';
import { initSentry } from '@/lib/sentry';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { bumpVisitCount, setupPwa } from '@/lib/pwa';
import '@/i18n';
import './index.css';

// Sentry: init prima del render così cattura errori di mount. No-op senza
// VITE_SENTRY_DSN (vedi lib/sentry.ts).
initSentry();

// PWA: registra service worker + listener install prompt. In dev è no-op.
// La toast "Nuova versione disponibile" usa Sonner (già montato sotto).
setupPwa((reload) => {
  toast.message('Aggiornamento disponibile', {
    description: 'Ricarica per applicare la nuova versione.',
    duration: Infinity,
    action: { label: 'Ricarica', onClick: reload },
  });
});

// Conteggio visite per la logica A2HS (prompt dopo 2ª visita).
bumpVisitCount();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
              <Toaster />
              <CookieBanner />
              <InstallPwaPrompt />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
