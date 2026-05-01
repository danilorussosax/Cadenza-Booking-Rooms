import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        // Component tests scope = componenti riusabili + utility lib.
        // Le pages/ sono integration-level (coperte dagli E2E Playwright in
        // ../e2e/): split classico component-vs-integration. Anche i dialog
        // admin grandi (CRUD pesante con setup DB) sono integration-level:
        // i loro flussi sono coperti da E2E + test backend route.
        include: ['src/components/**', 'src/lib/**'],
        exclude: [
          '**/*.d.ts',
          '**/_legacy/**',
          // Dialog admin: CRUD complesso DB-coupled, coperto da E2E + test backend
          'src/components/admin/**FormDialog.tsx',
          'src/components/admin/**ImportDialog.tsx',
          'src/components/admin/**Section.tsx',
          'src/components/admin/InstrumentLoanRulesTab.tsx',
          'src/components/admin/RulesPreview.tsx',
          'src/components/admin/MailTemplateEditor.tsx',
          'src/components/admin/QuotasManager.tsx',
          'src/components/admin/LoanQuotasManager.tsx',
          // Wrapper page-level (richiedono full app stack + auth context):
          // coperti da E2E. I sub-componenti restano nello scope.
          'src/components/layout/AppLayout.tsx',
          'src/components/layout/AuthLayout.tsx',
          'src/components/monteOre/MonteOreGrid.tsx',
          'src/components/profile/TwoFaSection.tsx',
          'src/components/legal/ConsentGate.tsx',
          'src/components/pwa/InstallPwaPrompt.tsx',
          'src/components/bookings/DayCalendar.tsx',
          // Componenti large che dipendono da AuthContext + React Query
          // multipli: copertura via E2E (con app full-stack) anziché unit
          // smoke (che richiederebbe mock pesanti senza valore).
          'src/components/bookings/WeeklyRoomTimetable.tsx',
          'src/components/bookings/WaitlistDashboardCard.tsx',
          'src/components/bookings/ConcertInfoDialog.tsx',
          'src/components/bookings/MultiRoomTimetable.tsx',
          'src/components/bookings/CalendarSubscriptionSection.tsx',
          'src/components/bookings/CancellationSection.tsx',
          'src/components/AnnouncementsCard.tsx',
          'src/components/ProtectedRoute.tsx',
        ],
        thresholds: {
          // Soglia non-regressione "component tests >= 60%". Branches/functions
          // sono naturalmente più bassi e crescono col tempo.
          statements: 60,
          lines: 60,
          functions: 50,
          branches: 50,
        },
      },
    },
  }),
);
