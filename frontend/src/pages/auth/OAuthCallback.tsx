import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LoaderCircle, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSessionToken } = useAuth();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    const needsProfile = params.get('needsProfile') === 'true';

    if (!token) {
      setError(t('auth.oauth_callback.missing_token'));
      return;
    }

    let cancelled = false;
    setSessionToken(token)
      .then((user) => {
        if (cancelled) return;
        const profileComplete =
          user.role === 'admin' ||
          (Boolean(user.courseId) && (user.role !== 'studente' || Boolean(user.matricola)));
        const approved = user.role === 'admin' || user.status === 'approved';
        let dest = '/dashboard';
        if (needsProfile || !profileComplete) dest = '/complete-profile';
        else if (!approved) dest = '/pending-approval';
        navigate(dest, { replace: true });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(httpErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [params, navigate, setSessionToken, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm rounded-xl border bg-card p-8 text-center shadow-sm"
      >
        {error ? (
          <>
            <ShieldAlert className="mx-auto mb-4 h-8 w-8 text-destructive" />
            <h1 className="mb-2 font-display text-xl font-medium">
              {t('auth.oauth_callback.error_title')}
            </h1>
            <p className="mb-5 text-sm text-muted-foreground">{error}</p>
            <Button
              onClick={() => {
                navigate('/login', { replace: true });
              }}
              className="w-full"
            >
              {t('auth.oauth_callback.back_to_login')}
            </Button>
          </>
        ) : (
          <>
            <LoaderCircle className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
            <h1 className="mb-1 font-display text-xl font-medium">
              {t('auth.oauth_callback.title')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('auth.oauth_callback.subtitle')}</p>
          </>
        )}
      </motion.div>
    </div>
  );
}
