import { useTranslation } from 'react-i18next';
import { Download, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi } from '@/api/users';
import { httpErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { todayLocalIso } from '@/lib/date';
import { saveBlob } from '@/lib/download';

import type { useUsersAdmin } from './useUsersAdmin';

type UsersAdmin = ReturnType<typeof useUsersAdmin>;

export function UsersActions({
  setImportingCsv,
  setCreating,
}: Pick<UsersAdmin, 'setImportingCsv' | 'setCreating'>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            const blob = await usersApi.downloadCsv();
            saveBlob(blob, `utenti-${todayLocalIso()}.csv`);
          } catch (err) {
            toast.error(httpErrorMessage(err));
          }
        }}
        title="Scarica utenti in CSV"
      >
        <Download className="h-4 w-4" />
        Esporta CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setImportingCsv(true);
        }}
        title="Importa utenti da CSV"
      >
        <Upload className="h-4 w-4" />
        Importa CSV
      </Button>
      <Button
        onClick={() => {
          setCreating(true);
        }}
      >
        <Plus className="h-4 w-4" />
        {t('admin.users.new_user')}
      </Button>
    </div>
  );
}
