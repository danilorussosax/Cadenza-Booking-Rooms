import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="font-display text-7xl font-medium text-primary">404</p>
      <h1 className="font-display text-2xl">{t('not_found.title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('not_found.subtitle')}</p>
      <Button asChild>
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
          {t('not_found.back')}
        </Link>
      </Button>
    </div>
  );
}
