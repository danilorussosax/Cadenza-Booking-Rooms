import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle,
  Mail,
  Save,
  Send,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  mailSettingsApi,
  type MailSettingsResponse,
  type MailSettingsView,
} from '@/api/mailSettings';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mailTemplatesApi } from '@/api/mailTemplates';
import { MailTemplateEditor } from '@/components/admin/MailTemplateEditor';

const schema = z.object({
  isEnabled: z.boolean(),
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().optional(),
  password: z.string().optional(),
  fromAddress: z
    .string()
    .optional()
    .refine((v) => !v || /\S+@\S+\.\S+/.test(v), 'Email non valida'),
  fromName: z.string().optional(),
  replyTo: z
    .string()
    .optional()
    .refine((v) => !v || /\S+@\S+\.\S+/.test(v), 'Email non valida'),
  throttlePerRecipientPerHour: z.number().int().min(0).max(1000),
});
type FormValues = z.infer<typeof schema>;

function StatusBadge({ s }: { s: MailSettingsView }) {
  if (s.source === 'database')
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Configurato (DB)
      </Badge>
    );
  if (s.source === 'database-disabled')
    return (
      <Badge variant="warning" className="gap-1">
        <ShieldOff className="h-3 w-3" />
        Disabilitato
      </Badge>
    );
  return (
    <Badge variant="muted" className="gap-1">
      <XCircle className="h-3 w-3" />
      Non configurato
    </Badge>
  );
}

export default function AdminMailSettings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [testTarget, setTestTarget] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'mail-settings'],
    queryFn: () => mailSettingsApi.get(),
  });
  const settings = query.data?.settings ?? null;
  const hasEnvFallback = query.data?.envFallback.hasEnvHost ?? false;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      isEnabled: false,
      host: '',
      port: 587,
      secure: false,
      username: '',
      password: '',
      fromAddress: '',
      fromName: '',
      replyTo: '',
      throttlePerRecipientPerHour: 0,
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        isEnabled: settings.isEnabled,
        host: settings.host ?? '',
        port: settings.port,
        secure: settings.secure,
        username: settings.username ?? '',
        password: '', // mai pre-compilato
        fromAddress: settings.fromAddress ?? '',
        fromName: settings.fromName ?? '',
        replyTo: settings.replyTo ?? '',
        throttlePerRecipientPerHour: settings.throttlePerRecipientPerHour,
      });
      if (!testTarget) setTestTarget(user?.email ?? '');
    }
  }, [settings, reset, user, testTarget]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      mailSettingsApi.update({
        isEnabled: values.isEnabled,
        host: values.host?.trim() ?? null,
        port: values.port,
        secure: values.secure,
        username: values.username?.trim() ?? null,
        // empty string non viene inviato (lascia invariato), valore valorizzato → cambia
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        password: values.password ? values.password : undefined,
        fromAddress: values.fromAddress?.trim() ?? null,
        fromName: values.fromName?.trim() ?? null,
        replyTo: values.replyTo?.trim() ?? null,
        throttlePerRecipientPerHour: values.throttlePerRecipientPerHour,
      }),
    onSuccess: ({ settings }) => {
      toast.success('Configurazione SMTP salvata');
      qc.setQueryData<MailSettingsResponse>(['admin', 'mail-settings'], (old) => ({
        envFallback: old?.envFallback ?? { hasEnvHost: false },
        settings,
      }));
      // pulisci il campo password
      setValue('password', '');
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  const [lastTestError, setLastTestError] = useState<{ message: string; raw?: string } | null>(
    null,
  );

  // "Tipo di email da testare": 'generic' = body fisso "Cadenza · email di test"
  // (utile per validare solo SMTP); altrimenti uno dei kind dei template, che
  // viene renderizzato con sample context (Mario Rossi, Aula Verdi, ecc.).
  const [testTemplateKind, setTestTemplateKind] = useState<string>('generic');

  // Lista template per il dropdown "Tipo email da testare". Usa la stessa
  // query già montata da MailTemplatesSection (TanStack dedupa).
  const testTemplatesQuery = useQuery({
    queryKey: ['admin', 'mail-templates'],
    queryFn: () => mailTemplatesApi.list(),
  });
  const testTemplates = testTemplatesQuery.data?.templates ?? [];

  const testMutation = useMutation({
    mutationFn: ({ to, kind }: { to: string; kind: string }) =>
      kind === 'generic' ? mailSettingsApi.test(to) : mailTemplatesApi.sendTest(kind, to),
    onSuccess: (res) => {
      if (res.ok) {
        setLastTestError(null);
        toast.success(`Email di test inviata a ${res.sentTo}`);
      } else {
        setLastTestError({ message: res.error ?? 'Errore invio test', raw: res.raw });
        toast.error(res.error ?? 'Errore invio test');
      }
    },
    onError: (err) => {
      const m = httpErrorMessage(err);
      setLastTestError({ message: m });
      toast.error(m);
    },
  });

  const isEnabled = watch('isEnabled');
  const secure = watch('secure');
  const port = watch('port');
  const hostValue = watch('host');

  // Typo detector: 'smpt.' è uno dei refusi più comuni di 'smtp.'.
  // Mostriamo un hint inline con auto-correzione invece di lasciare l'admin
  // scoprire l'errore solo dopo un fallimento DNS (getaddrinfo ENOTFOUND).
  const hostTypoSuggestion = (() => {
    const h = (hostValue ?? '').trim().toLowerCase();
    if (!h) return null;
    if (h.startsWith('smpt.')) return 'smtp.' + h.slice(5);
    return null;
  })();

  // Auto-sync porta ↔ secure per evitare il classico errore SSL "wrong version number"
  const handlePortChange = (newPort: number) => {
    setValue('port', newPort, { shouldDirty: true });
    if (newPort === 465 && !secure) setValue('secure', true, { shouldDirty: true });
    else if ((newPort === 587 || newPort === 25) && secure)
      setValue('secure', false, { shouldDirty: true });
  };
  const handleSecureChange = (newSecure: boolean) => {
    setValue('secure', newSecure, { shouldDirty: true });
    if (newSecure && (port === 587 || port === 25)) setValue('port', 465, { shouldDirty: true });
    else if (!newSecure && port === 465) setValue('port', 587, { shouldDirty: true });
  };

  const portMismatch = (port === 465 && !secure) || ((port === 587 || port === 25) && secure);

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">Server di posta</h1>
          <p className="text-sm text-muted-foreground">
            Configura il server SMTP usato per inviare conferme prenotazione, promemoria e altre
            notifiche.
          </p>
        </div>
        {settings && <StatusBadge s={settings} />}
      </header>

      {hasEnvFallback && settings?.source === 'env-fallback' && (
        <Alert variant="info">
          <AlertDescription>
            Le variabili d'ambiente <code>SMTP_*</code> sono attualmente attive come fallback.
            Salvando questa configurazione, prevarranno i valori inseriti qui.
          </AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={handleSubmit((v) => {
          setServerError(null);
          mutation.mutate(v);
        })}
        className="space-y-6"
        noValidate
      >
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <Mail className="h-5 w-5 text-muted-foreground" />
              Server SMTP
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-0 sm:pt-0">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Notifiche email attive</p>
                <p className="text-xs text-muted-foreground">
                  Disattiva per fermare temporaneamente l'invio di tutte le email.
                </p>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={(v) => {
                  setValue('isEnabled', v, { shouldDirty: true });
                }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px_160px]">
              <div className="space-y-2">
                <Label htmlFor="m-host">Host</Label>
                <Input id="m-host" placeholder="smtp.gmail.com" {...register('host')} />
                {hostTypoSuggestion && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Forse intendevi{' '}
                    <button
                      type="button"
                      className="font-mono font-medium underline underline-offset-2"
                      onClick={() => {
                        setValue('host', hostTypoSuggestion, { shouldDirty: true });
                      }}
                    >
                      {hostTypoSuggestion}
                    </button>
                    ? (typo comune <code>smpt.</code> → <code>smtp.</code>)
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-port">Porta</Label>
                <Input
                  id="m-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => {
                    handlePortChange(Number(e.target.value) || 0);
                  }}
                  aria-invalid={!!errors.port}
                  aria-describedby={errors.port ? 'm-port-error' : undefined}
                />
                <FieldError id="m-port-error">{errors.port?.message}</FieldError>
              </div>
              <div className="space-y-2">
                <Label className="block">Crittografia</Label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                  <Switch checked={secure} onCheckedChange={handleSecureChange} />
                  <span>{secure ? 'TLS implicito' : 'STARTTLS'}</span>
                </label>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Convenzione: <strong>porta 465 = TLS implicito</strong> ·{' '}
              <strong>porta 587 / 25 = STARTTLS</strong>. Se le combini al contrario otterrai un
              errore SSL "wrong version number".
            </p>
            {portMismatch && (
              <Alert variant="warning">
                <AlertDescription>
                  ⚠ Combinazione insolita: porta {port} con TLS{' '}
                  {secure ? 'implicito attivo' : 'disattivato'}. Verifica che sia davvero quanto
                  richiesto dal tuo provider.
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-user">Username</Label>
                <Input
                  id="m-user"
                  placeholder="apikey o user SMTP"
                  autoComplete="off"
                  {...register('username')}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="m-pass">
                    Password{' '}
                    {settings?.passwordSet && (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        salvata
                      </span>
                    )}
                  </Label>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setShowPassword((s) => !s);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="inline h-3.5 w-3.5" />
                    ) : (
                      <Eye className="inline h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <Input
                  id="m-pass"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={
                    settings?.passwordSet ? 'Lascia vuoto per non modificare' : 'Password SMTP'
                  }
                  {...register('password')}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-xl">Mittente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-0 sm:pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-from-name">Nome mittente</Label>
                <Input
                  id="m-from-name"
                  placeholder="Conservatorio Cadenza"
                  {...register('fromName')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-from-addr">Email mittente</Label>
                <Input
                  id="m-from-addr"
                  type="email"
                  placeholder="noreply@conservatorio.it"
                  aria-invalid={!!errors.fromAddress}
                  aria-describedby={errors.fromAddress ? 'm-from-addr-error' : undefined}
                  {...register('fromAddress')}
                />
                <FieldError id="m-from-addr-error">{errors.fromAddress?.message}</FieldError>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="m-replyto">Reply-To (opzionale)</Label>
              <Input
                id="m-replyto"
                type="email"
                placeholder="segreteria@conservatorio.it"
                aria-invalid={!!errors.replyTo}
                aria-describedby={errors.replyTo ? 'm-replyto-error' : undefined}
                {...register('replyTo')}
              />
              <FieldError id="m-replyto-error">{errors.replyTo?.message}</FieldError>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="m-throttle">Limite email/ora per destinatario</Label>
              <Input
                id="m-throttle"
                type="number"
                min={0}
                max={1000}
                {...register('throttlePerRecipientPerHour', { valueAsNumber: true })}
                aria-invalid={!!errors.throttlePerRecipientPerHour}
                aria-describedby="m-throttle-help"
              />
              <p id="m-throttle-help" className="text-[11px] text-muted-foreground">
                Anti-flapping: massimo numero di email all'ora verso lo stesso indirizzo. Le email
                di sicurezza (codici 2FA) bypassano sempre questo limite.{' '}
                <strong>0 = disabilitato</strong> (nessun limite). Valore ragionevole: 5–10.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!isDirty || isSubmitting}
            onClick={() =>
              settings &&
              reset({
                isEnabled: settings.isEnabled,
                host: settings.host ?? '',
                port: settings.port,
                secure: settings.secure,
                username: settings.username ?? '',
                password: '',
                fromAddress: settings.fromAddress ?? '',
                fromName: settings.fromName ?? '',
                replyTo: settings.replyTo ?? '',
                throttlePerRecipientPerHour: settings.throttlePerRecipientPerHour,
              })
            }
          >
            Reimposta
          </Button>
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salva configurazione
              </>
            )}
          </Button>
        </div>
      </form>

      <Separator />

      {/* Mail templates */}
      <MailTemplatesSection />

      <Separator />

      {/* Test send */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-xl">
              <Send className="h-5 w-5 text-muted-foreground" />
              Test invio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 sm:pt-0">
            <p className="text-sm text-muted-foreground">
              Invia un messaggio di prova per verificare che la configurazione funzioni. Salva prima
              eventuali modifiche. Puoi testare anche un modello specifico: verrà renderizzato con
              dati di esempio (Mario Rossi, Aula Verdi…) e prefissato <code>[TEST]</code> nel
              soggetto.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
              <Input
                type="email"
                value={testTarget}
                onChange={(e) => {
                  setTestTarget(e.target.value);
                }}
                placeholder="email destinatario"
                aria-label="Destinatario del test"
              />
              <Select value={testTemplateKind} onValueChange={setTestTemplateKind}>
                <SelectTrigger aria-label="Tipo di email da testare">
                  <SelectValue placeholder="Tipo di email…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generic">Email generica (no template)</SelectItem>
                  {testTemplates.map((t) => (
                    <SelectItem key={t.kind} value={t.kind}>
                      {t.label}
                      {!t.isEnabled && (
                        <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[9px] uppercase tracking-wider text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          OFF
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!testTarget || testMutation.isPending}
                onClick={() => {
                  testMutation.mutate({ to: testTarget, kind: testTemplateKind });
                }}
              >
                {testMutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Invia test
                  </>
                )}
              </Button>
            </div>
            {lastTestError && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium">{lastTestError.message}</p>
                  {lastTestError.raw && lastTestError.raw !== lastTestError.message && (
                    <details className="mt-2 text-xs opacity-80">
                      <summary className="cursor-pointer">Dettagli tecnici</summary>
                      <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px]">
                        {lastTestError.raw}
                      </pre>
                    </details>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// =====================================================
// Modelli email: tab per ogni kind, editor inline
// =====================================================
function MailTemplatesSection() {
  const tplQuery = useQuery({
    queryKey: ['admin', 'mail-templates'],
    queryFn: () => mailTemplatesApi.list(),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const templates = tplQuery.data?.templates ?? [];
  const vars = tplQuery.data?.availableVariables ?? [];

  // Selezione modello via dropdown (sostituisce il vecchio Tabs orizzontale
  // che, con 9 modelli, sforava la larghezza del Card).
  const [selectedKind, setSelectedKind] = useState<string>('');
  useEffect(() => {
    if (!selectedKind && templates.length > 0) {
      setSelectedKind(templates[0].kind);
    }
  }, [selectedKind, templates]);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const selected = templates.find((t) => t.kind === selectedKind) ?? templates[0] ?? null;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <FileText className="h-5 w-5 text-muted-foreground" />
          Modelli email
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        <p className="mb-4 text-sm text-muted-foreground">
          Personalizza oggetto e corpo HTML delle email automatiche. Le variabili tra{' '}
          <code className="rounded bg-muted px-1">{'{{ }}'}</code> vengono sostituite con i dati
          reali della prenotazione al momento dell'invio.
        </p>

        {tplQuery.isLoading && <Skeleton className="h-96 w-full" />}

        {templates.length > 0 && (
          <div className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <Label htmlFor="mail-template-select">Modello da modificare</Label>
              <Select value={selectedKind} onValueChange={setSelectedKind}>
                <SelectTrigger id="mail-template-select" className="w-full sm:max-w-md">
                  <SelectValue placeholder="Seleziona un modello…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.kind} value={t.kind}>
                      <span className="inline-flex items-center gap-2">
                        <span>{t.label}</span>
                        {!t.isEnabled && (
                          <span className="rounded-full bg-amber-100 px-1.5 text-[9px] uppercase tracking-wider text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            OFF
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
            {selected && (
              <div className="min-w-0">
                {/* key forza il remount dell'editor al cambio modello, così
                    non serve gestire manualmente la sincronizzazione di
                    subject/body con lo state interno (vedi useEffect dell'editor). */}
                <MailTemplateEditor
                  key={selected.kind}
                  template={selected}
                  availableVariables={vars}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
