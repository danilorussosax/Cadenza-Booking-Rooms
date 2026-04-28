import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, LoaderCircle, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { rulesApi } from '@/api/rules';
import { institutesApi } from '@/api/institutes';
import { coursesApi } from '@/api/courses';
import { httpErrorMessage } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Role } from '@/types';

/**
 * Card "Simula prenotazione" — riusa il validator backend con un fake user
 * del ruolo selezionato. Utile per testare configurazioni di regole/quote
 * senza creare una booking reale.
 *
 * Limiti per design (vedi backend rulesPreview.js): le quote individuali
 * (es. "max 8h già prenotate questa settimana") NON sono valutate, perché
 * il fake user (id=-1) non ha storia. Le regole strutturali (fascia oraria,
 * durata, anticipo, conflitti su altre booking, scope quota) sì.
 */
export function RulesPreview({ defaultRole }: { defaultRole: Role }) {
  const { t } = useTranslation();
  const [role, setRole] = useState<Role>(defaultRole);
  const [roomId, setRoomId] = useState<string>('');
  const [courseId, setCourseId] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [timeFrom, setTimeFrom] = useState<string>('10:00');
  const [timeTo, setTimeTo] = useState<string>('11:00');

  const structureQuery = useQuery({
    queryKey: ['structure', 'institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
    staleTime: 5 * 60 * 1000,
  });

  const coursesQuery = useQuery({
    queryKey: ['courses', 'active'],
    queryFn: () => coursesApi.list({ active: true }),
    staleTime: 5 * 60 * 1000,
  });

  const allRooms = (structureQuery.data?.institutes ?? []).flatMap((inst) =>
    inst.buildings.flatMap((b) =>
      b.rooms.map((r) => ({ id: r.id, label: `${b.name} · ${r.name}` })),
    ),
  );

  const previewMutation = useMutation({
    mutationFn: () => {
      // Combina date + ore in ISO (timezone locale del browser)
      const startTime = new Date(`${date}T${timeFrom}:00`).toISOString();
      const endTime = new Date(`${date}T${timeTo}:00`).toISOString();
      return rulesApi.preview({
        role,
        courseId: courseId ? Number(courseId) : null,
        roomId: Number(roomId),
        startTime,
        endTime,
      });
    },
  });

  const result = previewMutation.data;
  const error = previewMutation.error;

  const canSimulate = !!roomId && !!date && !!timeFrom && !!timeTo;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-purple-100 p-2 dark:bg-purple-500/15">
            <FlaskConical className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="space-y-0.5">
            <h3 className="font-display text-base font-medium">{t('admin.rules.preview.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('admin.rules.preview.subtitle')}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('admin.rules.preview.role')}</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as Role);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="studente">{t('admin.quotas.role.studente')}</SelectItem>
                <SelectItem value="docente">{t('admin.quotas.role.docente')}</SelectItem>
                <SelectItem value="admin">{t('admin.quotas.role.admin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('admin.rules.preview.course')}</Label>
            <Select
              value={courseId || '__none__'}
              onValueChange={(v) => {
                setCourseId(v === '__none__' ? '' : v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('admin.rules.preview.no_course')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('admin.rules.preview.no_course')}</SelectItem>
                {coursesQuery.data?.courses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t('admin.rules.preview.room')}</Label>
          <Select value={roomId} onValueChange={setRoomId} disabled={structureQuery.isLoading}>
            <SelectTrigger>
              <SelectValue placeholder={t('common.select_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {allRooms.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rp-date" className="text-xs">
              {t('admin.rules.preview.date')}
            </Label>
            <Input
              id="rp-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-from" className="text-xs">
              {t('admin.rules.preview.time_from')}
            </Label>
            <Input
              id="rp-from"
              type="time"
              value={timeFrom}
              onChange={(e) => {
                setTimeFrom(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-to" className="text-xs">
              {t('admin.rules.preview.time_to')}
            </Label>
            <Input
              id="rp-to"
              type="time"
              value={timeTo}
              onChange={(e) => {
                setTimeTo(e.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!canSimulate || previewMutation.isPending}
            onClick={() => {
              previewMutation.mutate();
            }}
          >
            {previewMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            {t('admin.rules.preview.simulate')}
          </Button>
        </div>

        {/* Esito */}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {httpErrorMessage(error)}
          </div>
        )}

        {result && (
          <div
            className={`rounded-lg border p-3 ${
              result.valid
                ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-500/10'
                : 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-500/10'
            }`}
          >
            <div className="flex items-center gap-2">
              {result.valid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              )}
              <span className="font-medium">
                {result.valid
                  ? t('admin.rules.preview.result_ok')
                  : t('admin.rules.preview.result_ko')}
              </span>
            </div>
            {!result.valid && result.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {result.errors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t('admin.rules.preview.disclaimer')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
