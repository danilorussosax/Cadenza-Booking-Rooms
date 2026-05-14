import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarPlus, LoaderCircle, PackageX, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi, loansApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { dayjs, formatDate, toLocalDateInput } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Instrument, InstrumentFamily } from '@/types';
import { ModuleDisabledCard } from '@/components/ModuleDisabledCard';
import { isModuleDisabledError } from '@/lib/moduleFlags';

const FAMILY_KEYS: InstrumentFamily[] = [
  'archi',
  'fiati_legni',
  'fiati_ottoni',
  'tastiere',
  'percussioni',
  'corde',
  'voce',
  'elettronica',
  'altro',
];

export default function Instruments() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState<InstrumentFamily | 'all'>('all');
  const [loanableOnly, setLoanableOnly] = useState(false);
  const [requestTarget, setRequestTarget] = useState<Instrument | null>(null);

  const query = useQuery({
    queryKey: ['instruments', { family, loanableOnly }],
    queryFn: () =>
      instrumentsApi.list({
        family: family === 'all' ? undefined : family,
        loanable: loanableOnly ? true : null,
      }),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return query.data?.instruments ?? [];
    return (query.data?.instruments ?? []).filter((i) =>
      [i.name, i.code, i.brand, i.model]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [query.data, search]);

  // Modulo Prestito strumenti disattivato → backend 404 MODULE_DISABLED.
  if (isModuleDisabledError(query.error)) {
    return <ModuleDisabledCard moduleLabel="Prestito strumenti" />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('instruments.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('instruments.subtitle')}</p>
      </header>

      {/* Filtri */}
      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder={t('instruments.search_placeholder')}
              className="pl-9"
            />
          </div>
          <Select
            value={family}
            onValueChange={(v) => {
              setFamily(v as typeof family);
            }}
          >
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('instruments.all_families')}</SelectItem>
              {FAMILY_KEYS.map((f) => (
                <SelectItem key={f} value={f}>
                  {t(`instrument_families.${f}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 self-center px-2 text-sm">
            <Switch checked={loanableOnly} onCheckedChange={setLoanableOnly} />
            {t('instruments.filter_loanable')}
          </label>
        </CardContent>
      </Card>

      {query.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <PackageX className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('instruments.no_results_title')}</p>
            <p className="text-sm text-muted-foreground">{t('instruments.no_results_subtitle')}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((it, idx) => (
          <motion.div
            key={it.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.02 * Math.min(idx, 12) }}
          >
            <InstrumentCard
              instrument={it}
              onRequest={() => {
                setRequestTarget(it);
              }}
            />
          </motion.div>
        ))}
      </div>

      <LoanRequestDialog
        instrument={requestTarget}
        onClose={() => {
          setRequestTarget(null);
        }}
      />
    </div>
  );
}

function InstrumentCard({
  instrument,
  onRequest,
}: {
  instrument: Instrument;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const status = instrumentStatus(instrument);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      {/* Cover photo 16:9 — fallback default svg */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        <img
          src={instrument.photoUrl ?? '/assets/instrument-default.svg'}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith('/assets/instrument-default.svg')) {
              img.src = '/assets/instrument-default.svg';
            }
          }}
        />
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          <Badge variant={status.variant}>{t(status.labelKey, status.params)}</Badge>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-medium leading-tight">{instrument.name}</h3>
          <p className="text-xs text-muted-foreground">
            {t(`instrument_families.${instrument.family}`)}
            {instrument.code ? ` · ${instrument.code}` : ''}
            {instrument.brand ? ` · ${instrument.brand}` : ''}
            {instrument.model ? ` · ${instrument.model}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{t(`instrument_conditions.${instrument.condition}`)}</Badge>
        </div>

        <div className="mt-auto space-y-1.5 pt-2">
          {status.blockedByRuleHelpKey && (
            <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              {t(status.blockedByRuleHelpKey)}
            </p>
          )}
          <Button
            variant="outline"
            className="w-full"
            disabled={!status.canRequest}
            onClick={onRequest}
            title={status.blockedByRuleHelpKey ? t(status.blockedByRuleHelpKey) : undefined}
          >
            <CalendarPlus className="h-4 w-4" />
            {t('instruments.request_loan')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface InstrumentStatusInfo {
  variant: 'success' | 'secondary' | 'muted';
  labelKey: string;
  params?: Record<string, unknown>;
  canRequest: boolean;
  /** Se non può richiedere a causa della LoanRule, espone il messaggio di help. */
  blockedByRuleHelpKey?: string;
}

function instrumentStatus(i: Instrument): InstrumentStatusInfo {
  if (!i.isLoanable || i.condition === 'fuori_uso' || i.condition === 'da_riparare') {
    return { variant: 'muted', labelKey: 'instruments.not_loanable', canRequest: false };
  }
  // L'utente corrente non è abilitato dalla regola di famiglia.
  // userAllowedForFamily è annotato lato backend (default true se mai impostato).
  if (i.userAllowedForFamily === false) {
    return {
      variant: 'muted',
      labelKey: 'instruments.course_not_allowed',
      canRequest: false,
      blockedByRuleHelpKey: 'instruments.course_not_allowed_help',
    };
  }
  if (
    i.currentLoanStatus &&
    (i.currentLoanStatus === 'active' ||
      i.currentLoanStatus === 'requested' ||
      i.currentLoanStatus === 'overdue')
  ) {
    return {
      variant: 'secondary',
      labelKey: 'instruments.borrowed_until',
      params: { date: i.currentLoanUntil ? formatDate(i.currentLoanUntil) : '—' },
      canRequest: false,
    };
  }
  return { variant: 'success', labelKey: 'instruments.available', canRequest: true };
}

// =====================================================
// Dialog richiesta prestito
// =====================================================
function LoanRequestDialog({
  instrument,
  onClose,
}: {
  instrument: Instrument | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = toLocalDateInput();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(toLocalDateInput(dayjs().add(7, 'day').toDate()));
  const [notes, setNotes] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      loansApi.request({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        instrumentId: instrument!.id,
        fromDate,
        toDate,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(t('instruments.request_dialog.submitted'));
      void qc.invalidateQueries({ queryKey: ['instruments'] });
      void qc.invalidateQueries({ queryKey: ['loans', 'mine'] });
      onClose();
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  // Reset dello stato all'apertura
  const open = !!instrument;
  // Memo del titolo per evitare re-render
  const title = instrument ? t('instruments.request_dialog.title', { name: instrument.name }) : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setServerError(null);
          setNotes('');
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('instruments.request_dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="loan-from">{t('instruments.request_dialog.from_date')}</Label>
              <Input
                id="loan-from"
                type="date"
                value={fromDate}
                min={today}
                onChange={(e) => {
                  setFromDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loan-to">{t('instruments.request_dialog.to_date')}</Label>
              <Input
                id="loan-to"
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loan-notes">{t('instruments.request_dialog.notes')}</Label>
            <Textarea
              id="loan-notes"
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              placeholder={t('instruments.request_dialog.notes_placeholder')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {t('instruments.request_dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
