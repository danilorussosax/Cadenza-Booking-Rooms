import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check, Mail, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import type { useUsersAdmin } from './useUsersAdmin';

type UsersAdmin = ReturnType<typeof useUsersAdmin>;

export function UsersBulkBar({
  selected,
  setSelected,
  pendingSelected,
  setBulkAction,
}: Pick<UsersAdmin, 'selected' | 'setSelected' | 'pendingSelected' | 'setBulkAction'>) {
  const { t } = useTranslation();
  if (selected.size === 0) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">
            {t('admin.users.bulk.selected_count', {
              count: selected.size,
              pending: pendingSelected.length,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              {t('admin.users.bulk.clear')}
            </Button>
            <Button
              size="sm"
              disabled={pendingSelected.length === 0}
              onClick={() => {
                setBulkAction('approve');
              }}
            >
              <Check className="h-4 w-4" />
              {t('admin.users.bulk.approve')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pendingSelected.length === 0}
              onClick={() => {
                setBulkAction('reject');
              }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" />
              {t('admin.users.bulk.reject')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkAction('setup_link');
              }}
            >
              <Mail className="h-4 w-4" />
              {t('admin.users.bulk.setup_link')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setBulkAction('delete');
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t('admin.users.bulk.delete')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
