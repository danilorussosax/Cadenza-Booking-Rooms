import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAppIcon } from '@/hooks/useAppIcon';
import type { User } from '@/types';
import { httpErrorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTranslation } from 'react-i18next';

const schema = z.object({
  email: z.string().email('email_required'),
  password: z.string().min(1, 'password_required'),
});
type FormValues = z.infer<typeof schema>;

function translateValidationKey(t: (k: string) => string, key?: string) {
  if (!key) return undefined;
  return t(`auth.validation.${key}`);
}

type Mode = 'choices' | 'email' | 'twofa';

export default function Login() {
  const [mode, setMode] = useState<Mode>('choices');
  const { loginWithCredentials, completeTwoFaLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Step 2 del login con 2FA: salviamo tempToken + info email in stato locale.
  const [twoFa, setTwoFa] = useState<{
    tempToken: string;
    sentTo: string;
    expiresInMinutes: number;
  } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaUseRecovery, setTwoFaUseRecovery] = useState(false);
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);
  const [twoFaResending, setTwoFaResending] = useState(false);
  const appIcon = useAppIcon();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const proceedAfterLogin = (user: User) => {
    const redirectTo =
      (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? null;
    const profileComplete =
      user.role === 'admin' ||
      (Boolean(user.courseId) && (user.role !== 'studente' || Boolean(user.matricola)));
    const approved = user.role === 'admin' || user.status === 'approved';
    let dest = '/dashboard';
    if (!profileComplete) dest = '/complete-profile';
    else if (!approved) dest = '/pending-approval';
    navigate(redirectTo ?? dest, { replace: true });
  };

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const result = await loginWithCredentials(values.email, values.password);
      if (result.kind === 'twofa') {
        setTwoFa({
          tempToken: result.tempToken,
          sentTo: result.sentTo,
          expiresInMinutes: result.expiresInMinutes,
        });
        setTwoFaCode('');
        setTwoFaUseRecovery(false);
        setMode('twofa');
        return;
      }
      proceedAfterLogin(result.user);
    } catch (err) {
      setServerError(httpErrorMessage(err));
    }
  };

  const handleTwoFaResend = async () => {
    if (!twoFa) return;
    setTwoFaResending(true);
    setServerError(null);
    try {
      const { authApi } = await import('@/api/auth');
      const res = await authApi.twoFaResend(twoFa.tempToken);
      setTwoFa({ ...twoFa, sentTo: res.sentTo, expiresInMinutes: res.expiresInMinutes });
    } catch (err) {
      setServerError(httpErrorMessage(err));
    } finally {
      setTwoFaResending(false);
    }
  };

  const onSubmitTwoFa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFa) return;
    setServerError(null);
    setTwoFaSubmitting(true);
    try {
      const trimmed = twoFaCode.trim();
      const payload = twoFaUseRecovery ? { recoveryCode: trimmed } : { code: trimmed };
      const user = await completeTwoFaLogin(twoFa.tempToken, payload);
      setTwoFa(null);
      setMode('email');
      proceedAfterLogin(user);
    } catch (err) {
      setServerError(httpErrorMessage(err));
    } finally {
      setTwoFaSubmitting(false);
    }
  };

  // Layout adottato da /complete-profile: AuthLayout split-panel (brand a sx,
  // form a dx). Le 3 viste (choices/email/2FA) restano come motion children
  // dentro lo stesso slot. Il pannello form ha sfondo immagine sfocato
  // (sfondo.png) con overlay theme-aware per garantire leggibilità.
  return (
    <AuthLayout formBgImage="/assets/sfondo.png">
      {/* Brand block sopra le 3 viste: logo Cadenza + nome + tagline.
          Persistente: presente in choices/email/twofa per coerenza.
          Centrato orizzontalmente sul pannello form. */}
      <div className="mb-7 flex items-center justify-center gap-3">
        <img src={appIcon} alt="" className="h-12 w-12 shrink-0 rounded-lg object-contain" />
        <div className="flex flex-col leading-tight">
          <span className="font-display text-2xl font-semibold tracking-tight text-primary">
            {t('app.name')}
          </span>
          <span className="text-sm text-muted-foreground">{t('app.tagline')}</span>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode === 'choices' && (
          <ChoicesView
            key="choices"
            onUseEmail={() => {
              setMode('email');
              setServerError(null);
            }}
          />
        )}
        {mode === 'email' && (
          <EmailView
            key="email"
            onBack={() => {
              setMode('choices');
            }}
            register={register}
            handleSubmit={handleSubmit(onSubmit)}
            errors={errors}
            isSubmitting={isSubmitting}
            serverError={serverError}
            showPassword={showPassword}
            onTogglePassword={() => {
              setShowPassword((s) => !s);
            }}
          />
        )}
        {mode === 'twofa' && twoFa && (
          <TwoFaView
            key="twofa"
            code={twoFaCode}
            onCodeChange={setTwoFaCode}
            useRecovery={twoFaUseRecovery}
            onToggleRecovery={() => {
              setTwoFaUseRecovery((v) => !v);
              setTwoFaCode('');
            }}
            submitting={twoFaSubmitting}
            serverError={serverError}
            sentTo={twoFa.sentTo}
            expiresInMinutes={twoFa.expiresInMinutes}
            resending={twoFaResending}
            onResend={() => {
              void handleTwoFaResend();
            }}
            onSubmit={onSubmitTwoFa}
            onCancel={() => {
              setTwoFa(null);
              setTwoFaCode('');
              setMode('email');
              setServerError(null);
            }}
          />
        )}
      </AnimatePresence>
    </AuthLayout>
  );
}

// ============================================================
// Choices view (OAuth + email/registrati)
//   Layout coerente con /complete-profile: titolo left-aligned,
//   sottotitolo muted, niente "shield hero" (il pannello di sx
//   già fornisce l'identità visiva del Conservatorio).
// ============================================================
function ChoicesView({ onUseEmail }: { onUseEmail: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <h2 className="font-display text-3xl font-medium tracking-tight">
          {t('auth.login.title_choices')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('auth.login.subtitle_choices')}</p>
      </div>

      {/* OAuth buttons */}
      <div className="space-y-2">
        <Button asChild variant="outline" className="h-11 w-full justify-center">
          <a href="/api/auth/google">
            <GoogleIcon />
            <span>{t('auth.login.continue_google')}</span>
          </a>
        </Button>
        <Button asChild variant="outline" className="h-11 w-full justify-center">
          <a href="/api/auth/microsoft">
            <MicrosoftIcon />
            <span>{t('auth.login.continue_microsoft')}</span>
          </a>
        </Button>
      </div>

      {/* Separator */}
      <div className="relative py-1 text-center">
        <span className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
        <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
          {t('common.or')}
        </span>
      </div>

      {/* Email + Register actions */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={onUseEmail}>
          <LogIn className="h-4 w-4" />
          <span>{t('auth.login.use_email')}</span>
        </Button>
        <Button asChild className="h-11">
          <Link to="/register">
            <UserPlus className="h-4 w-4" />
            <span>{t('auth.login.register')}</span>
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}

// ============================================================
// Email/password form view
// ============================================================
interface EmailViewProps {
  onBack: () => void;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  handleSubmit: () => void;
  errors: ReturnType<typeof useForm<FormValues>>['formState']['errors'];
  isSubmitting: boolean;
  serverError: string | null;
  showPassword: boolean;
  onTogglePassword: () => void;
}

function EmailView({
  onBack,
  register,
  handleSubmit,
  errors,
  isSubmitting,
  serverError,
  showPassword,
  onTogglePassword,
}: EmailViewProps) {
  const { t } = useTranslation();
  return (
    <motion.form
      key="email"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
      noValidate
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('auth.login.back_to_options')}
      </button>

      <div className="space-y-2">
        <h2 className="font-display text-3xl font-medium tracking-tight">
          {t('auth.login.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.fields.email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder={t('auth.fields.email_placeholder')}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email')}
        />
        <FieldError id="email-error">
          {errors.email && translateValidationKey(t, errors.email.message)}
        </FieldError>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('auth.fields.password')}</Label>
          <button
            type="button"
            tabIndex={-1}
            onClick={onTogglePassword}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPassword ? (
              <span className="inline-flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" /> {t('common.hide')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {t('common.show')}
              </span>
            )}
          </button>
        </div>
        <Input
          id="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'password-error' : undefined}
          {...register('password')}
        />
        <FieldError id="password-error">
          {errors.password && translateValidationKey(t, errors.password.message)}
        </FieldError>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {t('auth.login.submit')}
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>

      <p className="pt-1 text-center text-sm text-muted-foreground">
        {t('auth.login.no_account')}{' '}
        <Link
          to="/register"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('auth.login.register')}
        </Link>
      </p>
    </motion.form>
  );
}

// ============================================================
// Brand icons
// ============================================================
const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
    <path
      fill="#4285F4"
      d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.98 21.98 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
    />
    <path
      fill="#EA4335"
      d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
    />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
    <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
    <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
  </svg>
);

// ============================================================
// 2FA view (step 2 del login) — codice via EMAIL
// ============================================================
interface TwoFaViewProps {
  code: string;
  onCodeChange: (v: string) => void;
  useRecovery: boolean;
  onToggleRecovery: () => void;
  submitting: boolean;
  serverError: string | null;
  sentTo: string;
  expiresInMinutes: number;
  resending: boolean;
  onResend: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

function TwoFaView({
  code,
  onCodeChange,
  useRecovery,
  onToggleRecovery,
  submitting,
  serverError,
  sentTo,
  expiresInMinutes,
  resending,
  onResend,
  onSubmit,
  onCancel,
}: TwoFaViewProps) {
  const { t } = useTranslation();
  return (
    <motion.form
      key="twofa"
      onSubmit={onSubmit}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-5"
      noValidate
    >
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('auth.login.back_to_options')}
      </button>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="space-y-0.5">
            <h2 className="font-display text-2xl font-medium tracking-tight">
              {t('auth.twofa.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {useRecovery
                ? t('auth.twofa.subtitle_recovery')
                : t('auth.twofa.subtitle_email', { email: sentTo, minutes: expiresInMinutes })}
            </p>
          </div>
        </div>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="twofa-code">
          {useRecovery ? t('auth.twofa.recovery_label') : t('auth.twofa.code_label')}
        </Label>
        <Input
          id="twofa-code"
          autoFocus
          inputMode={useRecovery ? 'text' : 'numeric'}
          pattern={useRecovery ? undefined : '[0-9]*'}
          maxLength={useRecovery ? 24 : 6}
          autoComplete="one-time-code"
          placeholder={useRecovery ? 'XXXX-XXXX-XXXX-XXXX' : '••• •••'}
          value={code}
          onChange={(e) => {
            onCodeChange(e.target.value);
          }}
          className="text-center font-mono tracking-widest"
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={submitting || !code.trim()}>
        {submitting ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <LogIn className="h-4 w-4" />
        )}
        {t('auth.twofa.verify')}
      </Button>

      <div className="flex flex-col items-center gap-1">
        {!useRecovery && (
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {resending ? t('auth.twofa.resending') : t('auth.twofa.resend')}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleRecovery}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {useRecovery ? t('auth.twofa.use_email') : t('auth.twofa.use_recovery')}
        </button>
      </div>
    </motion.form>
  );
}
