import { useMutation } from '@tanstack/react-query';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/auth';
import { dayjs } from '@/lib/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { ProfileUser } from './types';

export function AccountSection({ user }: { user: ProfileUser }) {
  const { refreshUser } = useAuth();
  const { t } = useTranslation();
  const refreshMutation = useMutation({
    mutationFn: () => refreshUser(),
    onSuccess: () => toast.success(t('profile.personal.saved')),
  });

  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'ID', value: <span className="font-mono text-xs">{user.id}</span> },
    { label: t('profile.account.role'), value: t(`roles.${user.role}`) },
    { label: t('profile.account.matricola'), value: user.matricola ?? '—' },
    {
      label: t('profile.personal.course'),
      value: user.course ? `${user.course.code} — ${user.course.name}` : '—',
    },
    {
      label: t('profile.account.last_login'),
      value: user.lastLogin ? dayjs(user.lastLogin).format('DD MMM YYYY · HH:mm') : '—',
    },
    {
      label: 'Provider esterni',
      value: (
        <span className="flex flex-wrap gap-1">
          {!user.googleId && !user.microsoftId && '—'}
          {user.googleId && <Badge variant="secondary">Google</Badge>}
          {user.microsoftId && <Badge variant="secondary">Microsoft</Badge>}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          Informazioni account
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex justify-between gap-4 border-b py-2 last:border-0 sm:border-0 sm:py-1"
            >
              <dt className="text-sm text-muted-foreground">{item.label}</dt>
              <dd className="text-right text-sm font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
        <Separator className="my-4" />
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              refreshMutation.mutate();
            }}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              'Ricarica dati'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
