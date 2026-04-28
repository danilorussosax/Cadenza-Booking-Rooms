import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Sentry sourcemap upload: attivo solo se SENTRY_AUTH_TOKEN + SENTRY_ORG +
// SENTRY_PROJECT sono nelle env (es. in CI/CD). In dev locale: skip silente.
const SENTRY_UPLOAD = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default defineConfig({
  plugins: [
    react(),
    // PWA: manifest statico (public/manifest.webmanifest) + service worker
    // generato da Workbox con strategie:
    // - precache automatico di tutti gli /assets/* hashati (immutable)
    // - StaleWhileRevalidate 5min su /api/public/agenda + display-config
    //   (kiosk offline-soft + dashboard responsive)
    // - CacheFirst 1h su /api/structure/institutes (cambia raramente)
    // - NetworkOnly su tutto il resto sotto /api/* (mai cached)
    // injectRegister:false → la registrazione è esplicita lato client (lib/pwa.ts)
    // così possiamo controllare update/skipWaiting/A2HS in maniera coerente.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt', // l'utente decide se ricaricare per aggiornare
      injectRegister: false,
      manifest: false, // manifest fornito staticamente da public/manifest.webmanifest
      includeAssets: [
        'manifest.webmanifest',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-192.png',
        'icon-maskable-512.png',
        'theme-init.js',
        'assets/icona.svg',
        'assets/concerto.png',
        'assets/instrument-default.svg',
        'assets/room-default.svg',
        'assets/sfondo.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Esclude dal precache i chunk admin/raramente-usati: studenti e
        // docenti scaricano ~700 KB in meno al primo accesso. Restano
        // cacheabili runtime via SWR di Vite-PWA — gli admin pagheranno
        // un round-trip in più solo la prima volta.
        globIgnores: [
          '**/Analytics-*.js',
          '**/IsidataImport-*.js',
          '**/AuditLog-*.js',
          '**/Backups-*.js',
          '**/ServerSettings-*.js',
          '**/Rules-*.js',
          '**/MailSettings-*.js',
          '**/MessagingSettings-*.js',
          '**/Announcements-*.js',
          '**/Approvals-*.js',
          '**/Bookings-*.js',
        ],
        // Le immagini sono ora ottimizzate (~200 KB max), non serve più il
        // limite a 3 MB: 1 MB è abbastanza con margine.
        maximumFileSizeToCacheInBytes: 1 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//, // niente fallback HTML su request API
          /^\/storage\//, // upload utente serviti dal backend
          /^\/embed\//, // iframe pubblici (roadmap §5.8)
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: false, // attivazione esplicita via UI (no surprise reload)
        skipWaiting: false,
        runtimeCaching: [
          // Agenda pubblica + display config: SWR 5min. Garantisce kiosk
          // funzionante anche con backend irraggiungibile per qualche minuto.
          {
            urlPattern: ({ url }) =>
              url.pathname === '/api/public/agenda' ||
              url.pathname === '/api/public/display-config',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'public-agenda-v1',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 5 * 60, // 5 min
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Institutes: CacheFirst 1h. Cambia molto raramente (logo, città).
          {
            urlPattern: ({ url }) => /^\/api\/structure\/institutes(?:\/|$)/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'institutes-v1',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60, // 1h
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Foto utente / aula servite da /storage/* — cache lunga (immagini
          // sono già hashate dal backend con timestamp nel filename).
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'storage-v1',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7gg
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Google Fonts CSS + woff2 — runtime cache lunga.
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css-v1' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-static-v1',
              expiration: { maxAgeSeconds: 365 * 24 * 60 * 60, maxEntries: 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false, // SW disabilitato in `vite dev` per evitare cache invasiva
      },
    }),
    ...(SENTRY_UPLOAD
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: process.env.SENTRY_RELEASE },
            sourcemaps: { assets: './dist/**' },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Sourcemap necessari per Sentry: il plugin li carica e li rimuove dal
    // bundle finale (solo gli url di reference restano). Senza upload Sentry
    // questo aumenta lievemente la dimensione di dist/, accettabile.
    sourcemap: SENTRY_UPLOAD ? 'hidden' : false,
    // Allarghiamo il warning a 600 kB: il vecchio default 500 era troppo
    // restrittivo dato che dopo lo split per famiglia di lib la dimensione
    // di picco è ~500-550 kB pre-gzip su un paio di chunk specifici
    // (es. vendor-recharts contiene d3-*).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Strategia di chunking: una funzione `(id) => string | undefined`
        // perché l'oggetto-form di Rollup accetta solo array di stringhe
        // (nomi di pacchetti) e non match per scope (es. tutti i sub-pacchetti
        // di `@radix-ui/*`).
        //
        // Regole d'oro:
        //  1) react + react-dom + react-router-dom devono stare nello STESSO
        //     chunk: hanno relazione "peer" e dividerli causa
        //     "Cannot read property 'createContext' of undefined" se
        //     il bundle di react carica dopo react-router.
        //  2) framer-motion / lucide-react / dayjs sono già "leaf" pesanti
        //     senza dipendenze cross-chunk: chunk dedicati senza rischio.
        //  3) Tutto il resto in `vendor` generico (clsx, tailwind-merge,
        //     class-variance-authority, sonner, ecc.).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          // React + ecosistema routing in un unico chunk (vedi punto 1).
          // Includiamo anche le peer-deps di react-router 6
          // (@remix-run/router) e di altre lib React (use-sync-external-store,
          // react-is) per evitare warning di chunk circolare
          // "vendor → vendor-react → vendor".
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|react-is|use-sync-external-store)[\\/]/.test(
              id,
            ) ||
            id.includes('@remix-run/router')
          ) {
            return 'vendor-react';
          }

          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (id.includes('@tanstack/react-query')) return 'vendor-query';
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-recharts';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'vendor-i18n';
          if (
            id.includes('react-hook-form') ||
            id.includes('@hookform/resolvers') ||
            /[\\/]node_modules[\\/]zod[\\/]/.test(id)
          ) {
            return 'vendor-form';
          }
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('dayjs')) return 'vendor-dayjs';

          // Tutte le lib piccole (clsx, tailwind-merge, sonner, …) restano
          // nel vendor generico per non frammentare troppo il numero di
          // request HTTP/2 (l'overhead di una richiesta extra > il guadagno
          // di parallelismo per chunk < 5 kB).
          return 'vendor';
        },
      },
    },
  },
});
