import { buildProviderTk } from '@/pages/admin/integrations/isidata/isidataHelpers';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface DoneStepProps {
  tk: ReturnType<typeof buildProviderTk>;
  createdUserIds: number[];
  onReset: () => void;
  setupDialogOpen: boolean;
  onSetupDialogOpenChange: (open: boolean) => void;
  sending: boolean;
  onSendSetupLinks: (ids: number[]) => void;
}

export function DoneStep({
  tk,
  createdUserIds,
  onReset,
  setupDialogOpen,
  onSetupDialogOpenChange,
  sending,
  onSendSetupLinks,
}: DoneStepProps) {
  const { t } = useTranslation();
  const createdCount = createdUserIds.length;
  return (
    <>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <p className="text-xl font-medium">{tk('done_title')}</p>
          <p className="text-sm text-muted-foreground">{tk('done_hint')}</p>
          <Button onClick={onReset}>{tk('import_another')}</Button>
        </CardContent>
      </Card>

      {/* Banner CTA per il bulk-invio del magic-link "primo accesso" agli
              utenti appena creati. Compare solo se l'apply ha effettivamente
              creato utenti (createdUserIds non vuoto). L'admin può chiudere
              la modale per saltare: l'invio resta disponibile da pagina
              Utenti con la bulk action manuale. */}
      {createdCount > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <CardContent className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <div className="space-y-1">
                <p className="font-medium">
                  {tk('setup_banner.title', {
                    count: createdCount,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{tk('setup_banner.subtitle')}</p>
              </div>
            </div>
            <Button onClick={() => onSetupDialogOpenChange(true)} className="shrink-0">
              <Mail className="h-4 w-4" />
              {tk('setup_banner.cta', {
                count: createdCount,
              })}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Modale di conferma bulk-invio */}
      <Dialog open={setupDialogOpen} onOpenChange={onSetupDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tk('setup_dialog.title')}</DialogTitle>
            <DialogDescription>
              {tk('setup_dialog.description', {
                count: createdCount,
              })}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>· {tk('setup_dialog.bullet_skip_existing')}</li>
            <li>· {tk('setup_dialog.bullet_invalidate_previous')}</li>
            <li>· {tk('setup_dialog.bullet_one_link')}</li>
          </ul>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onSetupDialogOpenChange(false)}
              disabled={sending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (createdUserIds.length > 0) onSendSetupLinks(createdUserIds);
              }}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {tk('setup_dialog.confirm', {
                count: createdCount,
              })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
