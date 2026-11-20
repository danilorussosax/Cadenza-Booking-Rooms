import { motion } from 'framer-motion';
import { Mail, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/auth';
import { TwoFaSection } from '@/components/profile/TwoFaSection';
import { BotBindingsSection } from '@/components/profile/BotBindingsSection';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { isAdminUser } from '@/lib/roles';
import { ProfilePhotoUploader } from './profile/ProfilePhotoUploader';
import { PersonalSection } from './profile/PersonalSection';
import { PasswordSection } from './profile/PasswordSection';
import { NotificationsSection } from './profile/NotificationsSection';
import { PrivacySection } from './profile/PrivacySection';
import { AccountSection } from './profile/AccountSection';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const { t } = useTranslation();

  if (!user) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl font-medium sm:text-3xl">{t('profile.title')}</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">{t('profile.subtitle')}</p>
      </header>

      {/* Identity card */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:items-center sm:gap-5 sm:p-6 sm:text-left">
            <ProfilePhotoUploader user={user} updateUser={updateUser} />
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="font-display text-xl font-medium leading-tight">
                {user.firstName} {user.lastName}
              </h2>
              <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {user.email}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                <Badge variant="default">
                  {isAdminUser(user) && <ShieldCheck className="mr-1 h-3 w-3" />}
                  {t(`roles.${user.role}`)}
                </Badge>
                <Badge variant={user.isActive ? 'success' : 'muted'}>
                  {user.isActive ? t('common.active') : t('common.inactive')}
                </Badge>
                {user.googleId && <Badge variant="secondary">Google</Badge>}
                {user.microsoftId && <Badge variant="secondary">Microsoft</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <PersonalSection user={user} updateUser={updateUser} />
      <NotificationsSection user={user} updateUser={updateUser} />
      <PasswordSection isOAuthUser={!!(user.googleId ?? user.microsoftId)} />
      <TwoFaSection user={user} updateUser={updateUser} />
      <BotBindingsSection />
      <AccountSection user={user} />
      <PrivacySection user={user} />
    </div>
  );
}
