import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bookmark, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { bookingTemplatesApi } from '@/api/bookingTemplates';
import { httpErrorMessage } from '@/lib/api';
import { fromLocalInput } from '@/lib/date';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BookingType } from '@/types';

// =====================================================
// Sub-dialog "Salva come template"
// =====================================================
//
// Aperto dal pulsante secondario nel footer del BookingFormDialog. Riusa
// i valori CORRENTI del form principale (aula, orario, tipo, scopo) e
// chiede solo il nome + flag favorito. Il backend deriverà:
//   - dayOfWeek      = startTime.getDay()
//   - startMinutes   = ore*60 + minuti di startTime
//   - durationMinutes = (endTime - startTime) in minuti
export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  currentValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentValues: {
    roomId: number | null;
    startTime: string;
    endTime: string;
    type: BookingType;
    purpose: string;
  };
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setIsFavorite(false);
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!currentValues.roomId) throw new Error('no_room');
      const start = fromLocalInput(currentValues.startTime);
      const end = fromLocalInput(currentValues.endTime);
      const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      return bookingTemplatesApi.create({
        name: name.trim(),
        roomId: currentValues.roomId,
        dayOfWeek: start.getDay(),
        startMinutes: start.getHours() * 60 + start.getMinutes(),
        durationMinutes,
        type: currentValues.type,
        purpose: currentValues.purpose.trim() || null,
        isFavorite,
      });
    },
    onSuccess: (res) => {
      toast.success(t('booking.template.saved_toast', { name: res.template.name }));
      void qc.invalidateQueries({ queryKey: ['booking-templates'] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const canSave = name.trim().length > 0 && currentValues.roomId != null && !saveMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!saveMutation.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-primary" />
            {t('booking.template.save_dialog_title')}
          </DialogTitle>
          <DialogDescription>{t('booking.template.save_dialog_description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">{t('booking.template.name_label')}</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={t('booking.template.name_placeholder')}
              maxLength={100}
              autoFocus
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              checked={isFavorite}
              onChange={(e) => {
                setIsFavorite(e.target.checked);
              }}
            />
            <span>{t('booking.template.favorite_label')}</span>
          </label>
          <p className="text-[11px] text-muted-foreground">{t('booking.template.favorite_hint')}</p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={saveMutation.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              saveMutation.mutate();
            }}
            disabled={!canSave}
          >
            {saveMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
            {t('booking.template.save_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
