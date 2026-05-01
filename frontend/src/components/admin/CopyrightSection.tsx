import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copyright, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { httpErrorMessage } from '@/lib/api';
import { institutesApi } from '@/api/institutes';
import { structureApi } from '@/api/structure';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Sezione admin: testo di copyright mostrato nel footer di tutta l'app
 * (login, area utente, kiosk monitor). Persistito su `Institute.copyright`.
 *
 * Estratto da Profile.tsx in v2.4 e spostato dentro la macro
 * "Aspetto" di Impostazioni Server.
 */
export function CopyrightSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const instituteQuery = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });

  const institute = instituteQuery.data?.institute ?? null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<{ copyright: string }>({
    defaultValues: { copyright: '' },
  });

  useEffect(() => {
    if (institute) reset({ copyright: institute.copyright ?? '' });
  }, [institute, reset]);

  const mutation = useMutation({
    mutationFn: (values: { copyright: string }) => {
      if (!institute?.id) throw new Error('Istituto non trovato');
      return structureApi.updateInstitute(institute.id, {
        copyright: values.copyright.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('admin.appearance.copyright.saved'));
      void qc.invalidateQueries({ queryKey: ['institute', 'public'] });
    },
    onError: (err) => {
      setServerError(httpErrorMessage(err));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Copyright className="h-5 w-5 text-muted-foreground" />
          {t('admin.appearance.copyright.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
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
            <Label htmlFor="copyright-input">{t('admin.appearance.copyright.label')}</Label>
            <Input
              id="copyright-input"
              placeholder="Copyright © 2026 by Danilo Russo"
              maxLength={255}
              {...register('copyright')}
            />
            <p className="text-xs text-muted-foreground">{t('admin.appearance.copyright.hint')}</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset({ copyright: institute?.copyright ?? '' });
              }}
              disabled={!isDirty || isSubmitting}
            >
              {t('common.reset')}
            </Button>
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
