import { useMemo } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, GraduationCap, ShieldCheck, AlertCircle } from 'lucide-react';
import { docsApi, screenshotUrl, type ManualSlug } from '@/api/docs';
import { httpErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';

const SLUG_LABELS: Record<ManualSlug, { title: string; subtitle: string; icon: typeof BookOpen }> =
  {
    admin: {
      title: 'Manuale Amministratore',
      subtitle: 'Guida pratica per la gestione del Conservatorio',
      icon: ShieldCheck,
    },
    docente: {
      title: 'Manuale Docente',
      subtitle: 'Guida pratica per docenti, contrattisti e collaboratori',
      icon: GraduationCap,
    },
  };

/**
 * Pagina "Aiuto" — renderizza il manuale Markdown caricato dall'API.
 *
 * Strategia:
 *  - Il markdown è servito da GET /api/docs/:slug (autenticato + RBAC).
 *  - Gli screenshot referenziati come `screenshots/X.png` vengono riscritti
 *    a `/api/docs/screenshots/X.png` (rotta pubblica, perché <img src> non
 *    può passare l'header Authorization).
 *  - Il front-matter YAML del file viene rimosso prima del render perché è
 *    metadata destinato al converter LaTeX, non leggibile in UI.
 */
function isValidSlug(s: string | undefined): s is ManualSlug {
  return s === 'admin' || s === 'docente';
}

export default function HelpPage() {
  const { slug: rawSlug } = useParams<{ slug: string }>();
  const { user } = useAuth();

  // Normalizziamo lo slug PRIMA dei hook: se invalido o admin senza permessi
  // ricadiamo su 'docente' (l'effettivo redirect avviene dopo i hook tramite
  // <Navigate />). Questo è cruciale per non chiamare useQuery/useMemo
  // condizionalmente — react-hooks/rules-of-hooks lo vieta.
  const slug: ManualSlug = isValidSlug(rawSlug) ? rawSlug : 'docente';
  const needsRedirect = !isValidSlug(rawSlug) || (slug === 'admin' && user?.role !== 'admin');

  const query = useQuery({
    queryKey: ['docs', slug],
    queryFn: () => docsApi.get(slug),
    // Non fetchiamo se dobbiamo redirectare: evita una request inutile a /admin.
    enabled: !needsRedirect,
    // Cache 5 min: anche il backend cache 5 min in Cache-Control privato.
    staleTime: 5 * 60 * 1000,
  });

  // Preprocess del markdown:
  //  - rimuovi front-matter YAML (--- … ---) e il blocco <style>…</style>
  //    destinato al pandoc HTML/LaTeX
  //  - riscrivi i path immagini "screenshots/X.png" → "/api/docs/screenshots/X.png"
  const processed = useMemo(() => {
    if (!query.data) return '';
    let md = query.data;
    // YAML frontmatter
    if (md.startsWith('---')) {
      const end = md.indexOf('\n---', 3);
      if (end > 0) md = md.slice(end + 4).replace(/^\s*\n/, '');
    }
    // <style>…</style>
    md = md.replace(/<style>[\s\S]*?<\/style>/g, '');
    // immagini: ![alt](screenshots/file.png) → ![alt](/api/docs/screenshots/file.png)
    md = md.replace(
      /!\[([^\]]*)\]\(screenshots\/([^)]+)\)/g,
      (_m: string, alt: string, file: string) => {
        return `![${alt}](${screenshotUrl(file)})`;
      },
    );
    return md;
  }, [query.data]);

  // Tutti i hook sono stati chiamati: ora possiamo gestire il redirect senza
  // violare le rules-of-hooks.
  if (needsRedirect) {
    return <Navigate to="/help/docente" replace />;
  }

  const meta = SLUG_LABELS[slug];
  const Icon = meta.icon;

  // L'utente vede UN solo manuale alla volta, ma se è admin diamo un toggle
  // discreto per saltare all'altro manuale senza tornare alla sidebar.
  const showSwitch = user?.role === 'admin';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="inline-flex items-center gap-2 font-display text-3xl font-medium">
            <Icon className="h-7 w-7 text-primary" />
            {meta.title}
          </h1>
          <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
        </div>
        {showSwitch && (
          <div className="flex gap-2">
            <Link
              to="/help/docente"
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
                slug === 'docente' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              Docente
            </Link>
            <Link
              to="/help/admin"
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${
                slug === 'admin' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin
            </Link>
          </div>
        )}
      </header>

      {query.isLoading && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Impossibile caricare il manuale: {httpErrorMessage(query.error)}
          </AlertDescription>
        </Alert>
      )}

      {!query.isLoading && !query.isError && (
        <Card>
          <CardContent className="py-6">
            <article className="prose prose-slate dark:prose-invert prose-headings:font-display prose-headings:font-medium prose-h1:text-3xl prose-h2:mt-10 prose-h2:border-b prose-h2:pb-2 prose-h3:mt-6 prose-img:rounded-md prose-img:border prose-img:shadow-sm prose-table:text-sm prose-th:bg-muted/40 prose-th:py-2 prose-td:py-2 prose-blockquote:border-l-amber-500 prose-blockquote:bg-amber-50/40 dark:prose-blockquote:bg-amber-950/15 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:not-italic max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // Override img: aggiungiamo loading lazy + alt accessibile.
                  img: ({ src, alt, ...rest }) => (
                    <img
                      src={typeof src === 'string' ? src : ''}
                      alt={alt ?? ''}
                      loading="lazy"
                      {...rest}
                    />
                  ),
                  // I link interni del manuale (anchor di sezione) restano <a>,
                  // gli esterni si aprono in nuova tab.
                  a: ({ href, children, ...rest }) => {
                    const isExternal = href?.startsWith('http');
                    return (
                      <a
                        href={href}
                        target={isExternal ? '_blank' : undefined}
                        rel={isExternal ? 'noopener noreferrer' : undefined}
                        {...rest}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {processed}
              </ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      )}

      <footer className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Versione live del manuale — sincronizzata con il repository.
          {query.dataUpdatedAt && (
            <> Ultimo aggiornamento: {new Date(query.dataUpdatedAt).toLocaleString('it-IT')}.</>
          )}
        </span>
        <Badge variant="secondary">{slug}</Badge>
      </footer>
    </div>
  );
}
