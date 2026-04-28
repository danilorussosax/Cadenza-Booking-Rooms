import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bell,
  Calendar,
  LoaderCircle,
  Mail,
  Megaphone,
  Pencil,
  Pin,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  announcementsApi,
  type Announcement,
  type Audience,
  type AudienceKind,
  type UpsertAnnouncementPayload,
} from '@/api/announcements';
import { coursesApi } from '@/api/courses';
import { institutesApi } from '@/api/institutes';
import { httpErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { dayjs } from '@/lib/date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';

const AUDIENCE_KINDS: AudienceKind[] = ['all', 'role', 'course', 'building'];
const ROLES = ['studente', 'docente', 'admin'] as const;

const schema = z.object({
  title: z.string().min(1, 'title_required').max(200),
  body: z.string().min(1, 'body_required'),
  publishedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  audienceKind: z.enum(['all', 'role', 'course', 'building']),
  audienceValue: z.string().optional(),
  isPinned: z.boolean(),
  isActive: z.boolean(),
  sendEmail: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const DEFAULT_FORM: FormValues = {
  title: '',
  body: '',
  publishedAt: '',
  expiresAt: '',
  audienceKind: 'all',
  audienceValue: '',
  isPinned: false,
  isActive: true,
  sendEmail: false,
};

export default function AdminAnnouncements() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);

  const query = useQuery({
    queryKey: ['announcements', 'admin'],
    queryFn: () => announcementsApi.listAll(),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => announcementsApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.announcements.deleted'));
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      setConfirmDelete(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) => announcementsApi.resendEmail(id),
    onSuccess: ({ sent }) => {
      toast.success(t('admin.announcements.broadcast_sent', { count: sent ?? 0 }));
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const all = query.data?.announcements ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium inline-flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-rose-600 dark:text-rose-400" />
            {t('admin.announcements.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('admin.announcements.subtitle')}</p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t('admin.announcements.new')}
        </Button>
      </header>

      {query.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!query.isLoading && all.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">{t('admin.announcements.empty_title')}</p>
            <p className="text-sm text-muted-foreground">
              {t('admin.announcements.empty_subtitle')}
            </p>
          </CardContent>
        </Card>
      )}

      {!query.isLoading && all.length > 0 && (
        <div className="space-y-3">
          {all.map((a) => (
            <AnnouncementRow
              key={a.id}
              announcement={a}
              onEdit={() => {
                setEditing(a);
                setOpen(true);
              }}
              onDelete={() => {
                setConfirmDelete(a);
              }}
              onResend={() => {
                resendMutation.mutate(a.id);
              }}
              resendPending={resendMutation.isPending}
            />
          ))}
        </div>
      )}

      <AnnouncementFormDialog open={open} onOpenChange={setOpen} announcement={editing} />
      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={t('admin.announcements.delete_title')}
        description={t('admin.announcements.delete_description')}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function AnnouncementRow({
  announcement,
  onEdit,
  onDelete,
  onResend,
  resendPending,
}: {
  announcement: Announcement;
  onEdit: () => void;
  onDelete: () => void;
  onResend: () => void;
  resendPending: boolean;
}) {
  const { t } = useTranslation();
  const expired = announcement.expiresAt && new Date(announcement.expiresAt) < new Date();
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <Card className={cn(!announcement.isActive && 'opacity-60', expired && 'opacity-60')}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {announcement.isPinned && (
                <Badge variant="default" className="gap-1">
                  <Pin className="h-3 w-3" />
                  {t('admin.announcements.pinned')}
                </Badge>
              )}
              <AudienceBadge audience={announcement.audience} />
              {!announcement.isActive && (
                <Badge variant="muted">{t('admin.announcements.inactive')}</Badge>
              )}
              {expired && <Badge variant="muted">{t('admin.announcements.expired')}</Badge>}
              {announcement.emailSentAt && (
                <Badge variant="secondary" className="gap-1">
                  <Mail className="h-3 w-3" />
                  {t('admin.announcements.email_sent')}
                </Badge>
              )}
            </div>
            <h3 className="font-medium">{announcement.title}</h3>
            <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {announcement.body}
            </p>
            <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {dayjs(announcement.publishedAt).format('DD MMM YYYY')}
              {announcement.expiresAt && (
                <>
                  {' '}
                  · {t('admin.announcements.expires')}{' '}
                  {dayjs(announcement.expiresAt).format('DD MMM YYYY')}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t('admin.announcements.resend')}
              onClick={onResend}
              disabled={resendPending}
            >
              {resendPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t('common.edit')}
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t('common.delete')}
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function AudienceBadge({ audience }: { audience: Audience }) {
  const { t } = useTranslation();
  // Le label dei target risolte (course/building) richiederebbero query
  // multipli; per leggibilità mostriamo il kind tradotto e l'id grezzo.
  if (audience.kind === 'all') {
    return <Badge variant="secondary">{t('admin.announcements.audience.all')}</Badge>;
  }
  const valueStr =
    audience.kind === 'role'
      ? t(`admin.quotas.role.${audience.value as string}`)
      : `#${audience.value}`;
  return (
    <Badge variant="secondary" className="gap-1">
      <Bell className="h-3 w-3" />
      {t(`admin.announcements.audience.${audience.kind}`)} · {valueStr}
    </Badge>
  );
}

function AnnouncementFormDialog({
  open,
  onOpenChange,
  announcement,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  announcement: Announcement | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!announcement;

  const coursesQuery = useQuery({
    queryKey: ['courses', 'active'],
    queryFn: () => coursesApi.list({ active: true }),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const structureQuery = useQuery({
    queryKey: ['structure', 'institutes', 'full'],
    queryFn: () => institutesApi.listFull(),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const allBuildings = (structureQuery.data?.institutes ?? []).flatMap((inst) =>
    inst.buildings.map((b) => ({ id: b.id, label: `${inst.name} · ${b.name}` })),
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_FORM,
    values: announcement
      ? {
          title: announcement.title,
          body: announcement.body,
          publishedAt: announcement.publishedAt
            ? toLocalDateTimeInput(announcement.publishedAt)
            : '',
          expiresAt: announcement.expiresAt ? toLocalDateTimeInput(announcement.expiresAt) : '',
          audienceKind: announcement.audience.kind,
          audienceValue:
            announcement.audience.value != null ? String(announcement.audience.value) : '',
          isPinned: announcement.isPinned,
          isActive: announcement.isActive ?? true,
          sendEmail: false,
        }
      : undefined,
  });

  const audienceKind = form.watch('audienceKind');

  const submitMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const audience: Audience =
        values.audienceKind === 'all'
          ? { kind: 'all' }
          : values.audienceKind === 'role'
            ? { kind: 'role', value: values.audienceValue as 'admin' | 'docente' | 'studente' }
            : { kind: values.audienceKind, value: Number(values.audienceValue) };

      const payload: UpsertAnnouncementPayload = {
        title: values.title.trim(),
        body: values.body.trim(),
        publishedAt: values.publishedAt
          ? new Date(values.publishedAt).toISOString()
          : new Date().toISOString(),
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
        audience,
        isPinned: values.isPinned,
        isActive: values.isActive,
        sendEmail: values.sendEmail,
      };
      return isEdit
        ? announcementsApi.update(announcement.id, payload)
        : announcementsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('admin.announcements.updated') : t('admin.announcements.created'));
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const tFieldError = (key?: string) => {
    if (!key) return undefined;
    if (key === 'title_required') return t('admin.announcements.errors.title_required');
    if (key === 'body_required') return t('admin.announcements.errors.body_required');
    return key;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('admin.announcements.edit_title') : t('admin.announcements.new_title')}
          </DialogTitle>
          <DialogDescription>{t('admin.announcements.dialog_help')}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((v) => {
            submitMutation.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="ann-title">{t('admin.announcements.field.title')}</Label>
            <Input id="ann-title" {...form.register('title')} maxLength={200} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">
                {tFieldError(form.formState.errors.title.message)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ann-body">{t('admin.announcements.field.body')}</Label>
            <Textarea id="ann-body" rows={6} {...form.register('body')} />
            <p className="text-[11px] text-muted-foreground">
              {t('admin.announcements.field.body_help')}
            </p>
            {form.formState.errors.body && (
              <p className="text-xs text-destructive">
                {tFieldError(form.formState.errors.body.message)}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ann-pub">{t('admin.announcements.field.published_at')}</Label>
              <Input id="ann-pub" type="datetime-local" {...form.register('publishedAt')} />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.announcements.field.published_at_help')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ann-exp">{t('admin.announcements.field.expires_at')}</Label>
              <Input id="ann-exp" type="datetime-local" {...form.register('expiresAt')} />
              <p className="text-[11px] text-muted-foreground">
                {t('admin.announcements.field.expires_at_help')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('admin.announcements.field.audience')}</Label>
              <Select
                value={audienceKind}
                onValueChange={(v) => {
                  form.setValue('audienceKind', v as AudienceKind);
                  form.setValue('audienceValue', '');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`admin.announcements.audience.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audienceKind !== 'all' && (
              <div className="space-y-2">
                <Label>{t('admin.announcements.field.audience_target')}</Label>
                <Select
                  value={form.watch('audienceValue') ?? ''}
                  onValueChange={(v) => {
                    form.setValue('audienceValue', v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.select_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {audienceKind === 'role' &&
                      ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`admin.quotas.role.${r}`)}
                        </SelectItem>
                      ))}
                    {audienceKind === 'course' &&
                      (coursesQuery.data?.courses ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    {audienceKind === 'building' &&
                      allBuildings.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <ToggleRow
              title={t('admin.announcements.field.pinned')}
              help={t('admin.announcements.field.pinned_help')}
              checked={form.watch('isPinned')}
              onChange={(v) => {
                form.setValue('isPinned', v);
              }}
            />
            <ToggleRow
              title={t('admin.announcements.field.active')}
              help={t('admin.announcements.field.active_help')}
              checked={form.watch('isActive')}
              onChange={(v) => {
                form.setValue('isActive', v);
              }}
            />
            {!isEdit && (
              <ToggleRow
                title={t('admin.announcements.field.send_email')}
                help={t('admin.announcements.field.send_email_help')}
                checked={form.watch('sendEmail')}
                onChange={(v) => {
                  form.setValue('sendEmail', v);
                }}
              />
            )}
          </div>

          {isEdit && (
            <Alert variant="info">
              <AlertDescription className="text-xs">
                {t('admin.announcements.edit_email_disclaimer')}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={submitMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitMutation.isPending}>
              {submitMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                t('common.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  title,
  help,
  checked,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-[11px] text-muted-foreground">{help}</p>
    </div>
  );
}

// Conversione Date → input datetime-local (preserva timezone locale).
function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
