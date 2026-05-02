import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * E2E accessibility scan con axe-core.
 *
 * Scopo: in browser reale (no jsdom) misura il **contrasto colore** e
 * verifica le altre regole WCAG che non sono coperte dai test componente
 * (skip link visibility, focus management, landmark ordering, ARIA su
 * pages renderizzate con tutti i provider).
 *
 * Strategia: scansiona le pagine pubbliche ad alta visibilità (login,
 * register, privacy, terms) — il loro stato non dipende da auth/DB.
 *
 * Tag testati: WCAG 2.0/2.1 AA + best-practice axe. Solo violazioni
 * "serious"/"critical" failano il test; "minor"/"moderate" sono warning.
 */

const CRITICAL_IMPACTS = ['critical', 'serious'] as const;

test.describe('a11y: pagine pubbliche', () => {
  for (const path of ['/login', '/register', '/privacy-policy', '/terms']) {
    test(`axe scan su ${path} (no violazioni serious/critical)`, async ({ page }) => {
      await page.goto(path);
      // Aspetta che la pagina lazy-loaded sia idratata (Login/Register/...
      // sono code-split via React.lazy + Suspense).
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();

      const blocking = results.violations.filter((v) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        CRITICAL_IMPACTS.includes(v.impact as any),
      );

      if (blocking.length > 0) {
        // Stampa dettaglio leggibile per il triage
        console.error(
          `\n[a11y] ${blocking.length} violazioni serious/critical su ${path}:\n` +
            blocking
              .map(
                (v) =>
                  `  - ${v.id} (${v.impact}): ${v.description}\n    Help: ${v.helpUrl}\n    Nodes: ${v.nodes.length}`,
              )
              .join('\n'),
        );
      }

      expect(blocking, `axe ha rilevato violazioni serious/critical su ${path}`).toEqual([]);
    });
  }
});
