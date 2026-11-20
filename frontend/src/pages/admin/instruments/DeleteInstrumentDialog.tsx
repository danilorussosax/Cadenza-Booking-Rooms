import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { instrumentsApi } from '@/api/instruments';
import { httpErrorMessage } from '@/lib/api';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import type { Instrument } from '@/types';
import { invalidateInstruments } from '@/lib/invalidation';

// =====================================================
// Confirm delete dialog (con mutation)
// =====================================================
export function DeleteInstrumentDialog({
  target,
  error,
  onError,
  onClose,
}: {
  target: Instrument | null;
  error: string | null;
  onError: (s: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: number) => instrumentsApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.instruments.toast.deleted'));
      void invalidateInstruments(qc);
      onClose();
    },
    onError: (err) => {
      onError(httpErrorMessage(err));
    },
  });

  return (
    <ConfirmDeleteDialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={target ? t('admin.instruments.delete_title', { name: target.name }) : ''}
      description={t('admin.instruments.delete_description')}
      loading={mutation.isPending}
      error={error}
      onConfirm={() => target && mutation.mutate(target.id)}
    />
  );
}
