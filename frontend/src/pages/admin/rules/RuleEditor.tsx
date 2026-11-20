import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { LoaderCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { rulesApi } from '@/api/rules';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Role } from '@/types';
import { qk } from '@/lib/queryKeys';

import { ruleFormSchema, defaultsFor, toFormValues, type FormValues } from '@/lib/ruleForm';
import { Section, NumberField, TimeField, ToggleRow } from './RuleFormFields';
import { useTranslation } from 'react-i18next';

interface RuleEditorProps {
  role: Role;
  help: string;
}

export function RuleEditor({ role, help }: RuleEditorProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: qk.rules.forRole(role),
    queryFn: () => rulesApi.get(role),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: defaultsFor(),
  });

  useEffect(() => {
    if (query.data?.rule) {
      reset(toFormValues(query.data.rule));
      setServerError(null);
    }
  }, [query.data, reset]);

  const allowRecurring = watch('allowRecurring');
  const allowNightHours = watch('allowNightHours');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => rulesApi.upsert(role, values),
    onSuccess: ({ rule }) => {
      toast.success(t('toasts.rules.rules_updated'));
      qc.setQueryData(qk.rules.forRole(role), { rule });
      reset(toFormValues(rule));
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Card>
        <CardContent className="space-y-6 p-6">
          <p className="text-sm text-muted-foreground">{help}</p>

          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <form
            onSubmit={handleSubmit((values) => {
              setServerError(null);
              mutation.mutate(values);
            })}
            className="space-y-6"
            noValidate
          >
            <Section title="Volumi">
              <NumberField
                label="Prenotazioni attive contemporanee"
                helper="Massimo numero di prenotazioni future attive."
                name="maxActiveBookings"
                register={register}
                error={errors.maxActiveBookings?.message}
              />
              <NumberField
                label="Ore prenotabili per settimana"
                helper="Conteggio sull’ISO-week (lun → dom)."
                name="maxHoursPerWeek"
                register={register}
                error={errors.maxHoursPerWeek?.message}
              />
              <NumberField
                label="Ore prenotabili per giorno"
                name="maxHoursPerDay"
                register={register}
                error={errors.maxHoursPerDay?.message}
              />
            </Section>

            <Section title="Durata sessione">
              <NumberField
                label="Durata minima (minuti)"
                name="minBookingDurationMinutes"
                register={register}
                error={errors.minBookingDurationMinutes?.message}
              />
              <NumberField
                label="Durata massima (minuti)"
                name="maxBookingDurationMinutes"
                register={register}
                error={errors.maxBookingDurationMinutes?.message}
              />
              <NumberField
                label="Intervallo minimo tra prenotazioni (minuti)"
                helper="Cooldown obbligatorio tra una prenotazione e l’altra dello stesso utente. 0 = disattivato."
                name="minIntervalBetweenBookingsMinutes"
                register={register}
                error={errors.minIntervalBetweenBookingsMinutes?.message}
              />
            </Section>

            <Section title="Anticipo & cancellazione">
              <NumberField
                label="Anticipo massimo (giorni)"
                helper="Quanti giorni in anticipo si può prenotare."
                name="maxAdvanceDays"
                register={register}
                error={errors.maxAdvanceDays?.message}
              />
              <NumberField
                label="Anticipo minimo (ore)"
                helper="Tempo minimo prima dell’inizio."
                name="minAdvanceHours"
                register={register}
                error={errors.minAdvanceHours?.message}
              />
              <NumberField
                label="Limite cancellazione (ore)"
                helper="Ore prima dell’inizio entro cui si può cancellare."
                name="cancellationDeadlineHours"
                register={register}
                error={errors.cancellationDeadlineHours?.message}
              />
            </Section>

            <Section title="Fasce orarie consentite">
              <TimeField
                label="Inizio (HH:mm)"
                name="allowedStartTime"
                register={register}
                error={errors.allowedStartTime?.message}
              />
              <TimeField
                label="Fine (HH:mm)"
                name="allowedEndTime"
                register={register}
                error={errors.allowedEndTime?.message}
              />
            </Section>

            <Section title="Opzioni">
              <ToggleRow
                title="Permetti prenotazioni ricorrenti"
                description="Es. lezione settimanale per più settimane."
                checked={allowRecurring}
                onChange={(v) => {
                  setValue('allowRecurring', v, { shouldDirty: true });
                }}
              />
              <ToggleRow
                title="Permetti orario notturno"
                description="Disabilita per limitare alla fascia oraria sopra."
                checked={allowNightHours}
                onChange={(v) => {
                  setValue('allowNightHours', v, { shouldDirty: true });
                }}
              />
            </Section>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (query.data) reset(toFormValues(query.data.rule));
                }}
                disabled={!isDirty || isSubmitting}
              >
                Reimposta
              </Button>
              <Button type="submit" disabled={!isDirty || isSubmitting}>
                {isSubmitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
