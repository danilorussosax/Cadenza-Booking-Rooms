import { ExternalLink, LoaderCircle, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AnnouncementsCard } from './displayKiosk/AnnouncementsCard';
import { BookingsCard } from './displayKiosk/BookingsCard';
import { ConcertsCard } from './displayKiosk/ConcertsCard';
import { LinksCard } from './displayKiosk/LinksCard';
import { useDisplayKioskForm } from './displayKiosk/useDisplayKioskForm';

export default function AdminDisplayKiosk() {
  const { t } = useTranslation();
  const form = useDisplayKioskForm();
  const { buildings, saveMutation } = form;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-medium">{t('admin.display.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.display.subtitle')}</p>
        </div>
        <Button asChild variant="outline">
          <a href="/display" target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            {t('admin.display.open_display')}
          </a>
        </Button>
      </header>

      <Alert variant="info">
        <AlertDescription className="text-xs">{t('admin.display.preview_help')}</AlertDescription>
      </Alert>

      {form.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!form.isLoading && buildings.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('admin.display.no_buildings')}
          </CardContent>
        </Card>
      )}

      {!form.isLoading && buildings.length > 0 && (
        <>
          <BookingsCard
            buildings={buildings}
            rows={form.rows}
            updateRow={form.updateRow}
            bookings={form.bookings}
            setBookings={form.setBookings}
          />
          <LinksCard buildings={buildings} />
          <ConcertsCard concerts={form.concerts} setConcerts={form.setConcerts} />
          <AnnouncementsCard
            announcements={form.announcements}
            setAnnouncements={form.setAnnouncements}
          />
        </>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => {
            saveMutation.mutate();
          }}
          disabled={!form.dirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {t('admin.display.save')}
        </Button>
      </div>
    </div>
  );
}
