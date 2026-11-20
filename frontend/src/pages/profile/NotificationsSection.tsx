import { useMutation } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/api/auth';
import { httpErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { ProfileUser, UpdateUserFn } from './types';

export function NotificationsSection({
  user,
  updateUser,
}: {
  user: ProfileUser;
  updateUser: UpdateUserFn;
}) {
  const { t } = useTranslation();

  // Master switch: se false blocca tutti gli invii (anche se i singoli sono ON).
  const enabled = user.emailNotifications ?? true;
  // Granulari: default true se il backend non li ha ancora restituiti.
  const onConfirmation = user.notifyOnConfirmation ?? true;
  const onReminder = user.notifyOnReminder ?? true;
  const onCancellation = user.notifyOnCancellation ?? true;

  type Patch = Parameters<typeof authApi.updateMe>[0];

  const mutation = useMutation({
    mutationFn: (patch: Patch) => authApi.updateMe(patch),
    onSuccess: ({ user: updated }, patch) => {
      // Determina il valore booleano cambiato per il toast (l'unico cambio per chiamata).
      const changedKey = Object.keys(patch)[0] as keyof Patch | undefined;
      const newVal = changedKey ? (patch as Record<string, unknown>)[changedKey] : undefined;
      if (typeof newVal === 'boolean') {
        toast.success(
          t(newVal ? 'profile.notifications.saved_on' : 'profile.notifications.saved_off'),
        );
      }
      updateUser(updated);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const set = (patch: Patch) => {
    mutation.mutate(patch);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <Bell className="h-5 w-5 text-muted-foreground" />
          {t('profile.notifications.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 sm:pt-0">
        <p className="text-sm text-muted-foreground">{t('profile.notifications.description')}</p>

        {/* Master switch */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
          <div className="space-y-1 pr-3">
            <p className="text-sm font-medium">{t('profile.notifications.master_title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('profile.notifications.master_help')}
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={mutation.isPending}
            onCheckedChange={(v) => {
              set({ emailNotifications: v });
            }}
            aria-label={t('profile.notifications.master_title')}
          />
        </div>

        {/* Toggle granulari (disabilitati visivamente se il master è OFF) */}
        <div
          className={cn('space-y-2 transition-opacity', !enabled && 'opacity-60')}
          aria-disabled={!enabled}
        >
          <NotificationToggleRow
            title={t('profile.notifications.confirmation_title')}
            help={t('profile.notifications.confirmation_help')}
            checked={onConfirmation}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnConfirmation: v });
            }}
          />
          <NotificationToggleRow
            title={t('profile.notifications.reminder_title')}
            help={t('profile.notifications.reminder_help')}
            checked={onReminder}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnReminder: v });
            }}
          />
          <NotificationToggleRow
            title={t('profile.notifications.cancellation_title')}
            help={t('profile.notifications.cancellation_help')}
            checked={onCancellation}
            disabled={!enabled || mutation.isPending}
            onChange={(v) => {
              set({ notifyOnCancellation: v });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationToggleRow({
  title,
  help,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5 pr-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
