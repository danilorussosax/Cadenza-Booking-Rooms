import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clock, LogOut, RefreshCw, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';

export default function PendingApproval() {
  const { user, refreshUser, logout, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleLogout = () => {
    logout();
    void navigate('/login', { replace: true });
  };

  const handleRefresh = async () => {
    const u = await refreshUser();
    if (u && (u.role === 'admin' || u.status === 'approved')) {
      void navigate('/dashboard', { replace: true });
    }
  };

  const isRejected = user?.status === 'rejected';

  return (
    <AuthLayout quote={t('auth.pending.quote')} attribution={t('auth.pending.quote_attribution')}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-6"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          {isRejected ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/20">
              <ShieldX className="h-8 w-8 text-destructive" />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:ring-amber-400/30">
              <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            </div>
          )}

          <h2 className="font-display text-3xl font-medium tracking-tight">
            {isRejected ? t('auth.pending.rejected_title') : t('auth.pending.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isRejected ? t('auth.pending.rejected_subtitle') : t('auth.pending.subtitle')}
          </p>
        </div>

        {user && (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {t(`roles.${user.role}`)}
              </span>
              <span
                className={
                  isRejected
                    ? 'rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive'
                    : 'rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300'
                }
              >
                {isRejected ? t('user_status.rejected') : t('user_status.pending')}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {!isRejected && (
            <Button onClick={handleRefresh} disabled={loading} className="w-full">
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              {t('auth.pending.verify_status')}
            </Button>
          )}
          <Button variant="outline" onClick={handleLogout} className="w-full">
            <LogOut className="h-4 w-4" />
            {t('common.logout')}
          </Button>
        </div>
      </motion.div>
    </AuthLayout>
  );
}
