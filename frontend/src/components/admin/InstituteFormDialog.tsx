import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { structureApi } from '@/api/structure';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { Institute, SubProcessor } from '@/types';

const schema = z.object({
  name: z.string().min(1, 'Inserisci il nome dell’istituto'),
  code: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  // Dati legali (privacy/termini). Tutti opzionali ma usati nelle pagine pubbliche.
  legalName: z.string().max(255).optional(),
  vatNumber: z.string().max(32).optional(),
  fiscalCode: z.string().max(32).optional(),
  pecEmail: z.string().max(255).optional().or(z.literal('')),
  contactEmail: z.string().max(255).optional().or(z.literal('')),
  dpoName: z.string().max(255).optional(),
  dpoEmail: z.string().max(255).optional().or(z.literal('')),
  jurisdictionCity: z.string().max(100).optional(),
  // Sub-processor: una riga per provider, formato "Nome | Finalità | Localizzazione | URL DPA".
  subProcessorsText: z.string().max(4000).optional(),
});

type FormValues = z.infer<typeof schema>;

// Serializza un array di SubProcessor nel formato testuale del textarea.
function subProcessorsToText(list: SubProcessor[] | null | undefined): string {
  if (!Array.isArray(list)) return '';
  return list
    .map((sp) =>
      [sp.name, sp.purpose ?? '', sp.location ?? '', sp.dpaUrl ?? '']
        .map((s) => s.trim())
        .join(' | '),
    )
    .join('\n');
}

// Parser inverso. Righe vuote ignorate, "|" è il separatore di colonna.
function parseSubProcessors(text: string | undefined): SubProcessor[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = '', purpose = '', location = '', dpaUrl = ''] = line
        .split('|')
        .map((s) => s.trim());
      const sp: SubProcessor = { name };
      if (purpose) sp.purpose = purpose;
      if (location) sp.location = location;
      if (dpaUrl) sp.dpaUrl = dpaUrl;
      return sp;
    })
    .filter((sp) => sp.name.length > 0);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institute?: Institute | null;
}

export function InstituteFormDialog({ open, onOpenChange, institute }: Props) {
  const qc = useQueryClient();
  const isEdit = !!institute;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      code: '',
      address: '',
      city: '',
      country: 'Italia',
      description: '',
      legalName: '',
      vatNumber: '',
      fiscalCode: '',
      pecEmail: '',
      contactEmail: '',
      dpoName: '',
      dpoEmail: '',
      jurisdictionCity: '',
      subProcessorsText: '',
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: institute?.name ?? '',
        code: institute?.code ?? '',
        address: institute?.address ?? '',
        city: institute?.city ?? '',
        country: institute?.country ?? 'Italia',
        description: institute?.description ?? '',
        legalName: institute?.legalName ?? '',
        vatNumber: institute?.vatNumber ?? '',
        fiscalCode: institute?.fiscalCode ?? '',
        pecEmail: institute?.pecEmail ?? '',
        contactEmail: institute?.contactEmail ?? '',
        dpoName: institute?.dpoName ?? '',
        dpoEmail: institute?.dpoEmail ?? '',
        jurisdictionCity: institute?.jurisdictionCity ?? '',
        subProcessorsText: subProcessorsToText(institute?.subProcessors),
      });
      setServerError(null);
    }
  }, [open, institute, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const subProcessors = parseSubProcessors(values.subProcessorsText);
      const payload = {
        name: values.name.trim(),
        code: values.code?.trim() ?? null,
        address: values.address?.trim() ?? null,
        city: values.city?.trim() ?? null,
        country: values.country?.trim() ?? null,
        description: values.description?.trim() ?? null,
        legalName: values.legalName?.trim() ?? null,
        vatNumber: values.vatNumber?.trim() ?? null,
        fiscalCode: values.fiscalCode?.trim() ?? null,
        pecEmail: values.pecEmail?.trim() ?? null,
        contactEmail: values.contactEmail?.trim() ?? null,
        dpoName: values.dpoName?.trim() ?? null,
        dpoEmail: values.dpoEmail?.trim() ?? null,
        jurisdictionCity: values.jurisdictionCity?.trim() ?? null,
        subProcessors: subProcessors.length ? subProcessors : null,
      };
      return isEdit
        ? structureApi.updateInstitute(institute.id, payload)
        : structureApi.createInstitute(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Istituto aggiornato' : 'Istituto creato');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
      onOpenChange(false);
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifica istituto' : 'Nuovo istituto'}</DialogTitle>
          <DialogDescription>
            Le informazioni dell’istituto saranno mostrate nelle pagine di login e nella sidebar.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => {
            mutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="i-name">Nome</Label>
            <Input id="i-name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="i-code">Codice (opzionale)</Label>
              <Input id="i-code" {...register('code')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-city">Città</Label>
              <Input id="i-city" {...register('city')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-address">Indirizzo</Label>
            <Input id="i-address" {...register('address')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-description">Descrizione</Label>
            <Textarea id="i-description" rows={3} {...register('description')} />
          </div>

          {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
          {isEdit && institute && <LogoUploader institute={institute} />}

          <div className="border-t pt-4">
            <h3 className="font-display text-base font-medium">Dati legali e privacy</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Compilati nelle pagine pubbliche /privacy-policy e /terms. Lasciare vuoti i campi non
              applicabili.
            </p>

            <div className="mt-3 space-y-2">
              <Label htmlFor="i-legalName">Denominazione legale completa</Label>
              <Input
                id="i-legalName"
                {...register('legalName')}
                placeholder="Conservatorio di Musica Statale ..."
              />
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="i-vat">P. IVA</Label>
                <Input id="i-vat" {...register('vatNumber')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-cf">Codice fiscale</Label>
                <Input id="i-cf" {...register('fiscalCode')} />
              </div>
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="i-contact">Email di contatto</Label>
                <Input id="i-contact" type="email" {...register('contactEmail')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-pec">PEC istituzionale</Label>
                <Input id="i-pec" type="email" {...register('pecEmail')} />
              </div>
            </div>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="i-dpo-name">Nome DPO</Label>
                <Input id="i-dpo-name" {...register('dpoName')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="i-dpo-email">Email DPO</Label>
                <Input id="i-dpo-email" type="email" {...register('dpoEmail')} />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <Label htmlFor="i-jurisdiction">Foro competente (città)</Label>
              <Input
                id="i-jurisdiction"
                {...register('jurisdictionCity')}
                placeholder="Default: città dell'istituto"
              />
            </div>

            <div className="mt-3 space-y-2">
              <Label htmlFor="i-subp">Sub-processor (responsabili esterni)</Label>
              <Textarea
                id="i-subp"
                rows={6}
                {...register('subProcessorsText')}
                placeholder={
                  'Una riga per fornitore, formato:\nNome | Finalità | Localizzazione | URL DPA\nEsempio:\nStripe | Pagamenti | USA (DPF) | https://stripe.com/dpa\nMeta Platforms (WhatsApp Cloud API) | Bot messaging | USA (SCC) | https://www.whatsapp.com/legal/business-data-transfer-addendum\nTwilio | Bot messaging WhatsApp | USA (DPF) | https://www.twilio.com/legal/data-protection-addendum\nTelegram FZ-LLC | Bot messaging | UAE | https://telegram.org/privacy'
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Mostrato nella tabella della Privacy Policy. Il separatore di colonna è il carattere
                "|". Se hai attivato un canale bot in <code>/admin/messaging</code>, ricordati di
                dichiarare il relativo provider qui.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              Annulla
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : isEdit ? (
                'Salva'
              ) : (
                'Crea istituto'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================
// Sub-component: upload del logo dell'istituto su file system
// =====================================================
function LogoUploader({ institute }: { institute: Institute }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => structureApi.uploadInstituteLogo(institute.id, file),
    onSuccess: () => {
      toast.success('Logo aggiornato');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => structureApi.deleteInstituteLogo(institute.id),
    onSuccess: () => {
      toast.success('Logo rimosso');
      void qc.invalidateQueries({ queryKey: ['institutes'] });
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
    },
    onError: (err) => {
      setError(httpErrorMessage(err));
    },
  });

  const hasLogo = !!institute.logoUrl;

  return (
    <div className="space-y-2">
      <Label>Logo istituto</Label>
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-card ring-1 ring-border">
          {hasLogo ? (
            <img src={institute.logoUrl ?? ''} alt="" className="h-12 w-12 object-contain" />
          ) : (
            <ImageUp className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{hasLogo ? 'Logo configurato' : 'Nessun logo'}</p>
          <p className="text-[11px] text-muted-foreground">PNG · JPG · WEBP · SVG · max 2 MB</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ImageUp className="h-4 w-4" />
            )}
            {hasLogo ? 'Cambia' : 'Carica'}
          </Button>
          {hasLogo && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Rimuovi logo"
              onClick={() => {
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setError(null);
              uploadMutation.mutate(f);
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
