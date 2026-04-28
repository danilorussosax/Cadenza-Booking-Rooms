import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// i18n minimale per i test: non scarichiamo i json reali (sono grossi e
// lenti da parsare) ma usiamo un fallback che ritorna la chiave stessa.
// I test si basano su `t('foo.bar') === 'foo.bar'`.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'it',
    fallbackLng: 'it',
    resources: { it: { translation: {} } },
    interpolation: { escapeValue: false },
    // missingKeyHandler restituisce la chiave: utile per asserzioni
    parseMissingKeyHandler: (key) => key,
  });
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
  initialRoute?: string;
}

export function AllProviders({ children, queryClient, initialRoute = '/' }: ProvidersProps) {
  const client = queryClient ?? makeQueryClient();
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialRoute]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { initialRoute?: string; queryClient?: QueryClient },
) {
  const { initialRoute, queryClient, ...rest } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders queryClient={queryClient} initialRoute={initialRoute}>
        {children}
      </AllProviders>
    ),
    ...rest,
  });
}

export * from '@testing-library/react';
