import { useTranslation } from 'react-i18next';
import { ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { UsersCsvImportDialog } from '@/components/admin/UsersCsvImportDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserFormDialog } from '@/components/admin/UserFormDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';

import { useUsersAdmin } from './users/useUsersAdmin';
import { UsersActions } from './users/UsersActions';
import { UsersFilters } from './users/UsersFilters';
import { UsersBulkBar } from './users/UsersBulkBar';
import { UsersTable } from './users/UsersTable';
import { SsoTabContent } from './users/SsoTabContent';

export default function AdminUsers() {
  const { t } = useTranslation();
  const vm = useUsersAdmin();
  const {
    tab,
    handleTabChange,
    creating,
    setCreating,
    editTarget,
    setEditTarget,
    deleteTarget,
    setDeleteTarget,
    deleteError,
    setDeleteError,
    deleteMutation,
    bulkAction,
    setBulkAction,
    selected,
    pendingSelected,
    bulkApproveMutation,
    bulkDeleteMutation,
    bulkSetupLinksMutation,
    importingCsv,
    setImportingCsv,
  } = vm;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-3xl font-medium">{t('admin.users.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.users.subtitle')}</p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="grid h-auto w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-2">
          <TabsTrigger
            value="users"
            className="group flex h-auto flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left shadow-xs hover:bg-accent data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 text-primary" />
              <span className="text-base font-semibold">Utenti</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Lista, ruoli, approvazioni, import/export CSV
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="sso"
            className="group flex h-auto flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left shadow-xs hover:bg-accent data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-base font-semibold">SSO</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Login Google &amp; Microsoft, domini consentiti, import Isidata
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-6 space-y-6">
          <UsersActions {...vm} />
          <UsersFilters {...vm} />
          <UsersBulkBar {...vm} />
          <UsersTable {...vm} />
        </TabsContent>

        <TabsContent value="sso" className="mt-6">
          {/* Configurazione SSO (Google/Microsoft), whitelist domini email
              consentiti al login OAuth e importazione anagrafica Isidata. */}
          <SsoTabContent />
        </TabsContent>
      </Tabs>

      <UserFormDialog open={creating} onOpenChange={setCreating} />
      <UserFormDialog
        open={!!editTarget}
        onOpenChange={(o) => !o && setEditTarget(null)}
        user={editTarget}
      />
      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={t('admin.users.delete_title', {
          name: `${deleteTarget?.firstName ?? ''} ${deleteTarget?.lastName ?? ''}`.trim(),
        })}
        description={t('admin.users.delete_description')}
        loading={deleteMutation.isPending}
        error={deleteError}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />

      {/* Bulk action confirm: approve / reject / delete con riepilogo. */}
      <ConfirmDeleteDialog
        open={bulkAction !== null}
        onOpenChange={(o) => {
          if (!o) setBulkAction(null);
        }}
        title={
          bulkAction === 'approve'
            ? t('admin.users.bulk.confirm.approve_title')
            : bulkAction === 'reject'
              ? t('admin.users.bulk.confirm.reject_title')
              : bulkAction === 'setup_link'
                ? t('admin.users.bulk.confirm.setup_link_title')
                : t('admin.users.bulk.confirm.delete_title')
        }
        description={
          bulkAction === 'delete'
            ? t('admin.users.bulk.confirm.delete_description', { count: selected.size })
            : bulkAction === 'setup_link'
              ? t('admin.users.bulk.confirm.setup_link_description', { count: selected.size })
              : t('admin.users.bulk.confirm.approve_reject_description', {
                  count: pendingSelected.length,
                  skipped: selected.size - pendingSelected.length,
                })
        }
        confirmLabel={
          bulkAction === 'approve'
            ? t('admin.users.bulk.approve')
            : bulkAction === 'reject'
              ? t('admin.users.bulk.reject')
              : bulkAction === 'setup_link'
                ? t('admin.users.bulk.setup_link')
                : t('admin.users.bulk.delete')
        }
        variant={
          bulkAction === 'approve' || bulkAction === 'setup_link' ? 'default' : 'destructive'
        }
        loading={
          bulkApproveMutation.isPending ||
          bulkDeleteMutation.isPending ||
          bulkSetupLinksMutation.isPending
        }
        onConfirm={() => {
          if (bulkAction === 'approve') bulkApproveMutation.mutate('approve');
          else if (bulkAction === 'reject') bulkApproveMutation.mutate('reject');
          else if (bulkAction === 'delete') bulkDeleteMutation.mutate();
          else if (bulkAction === 'setup_link') bulkSetupLinksMutation.mutate();
        }}
      />

      <UsersCsvImportDialog open={importingCsv} onOpenChange={setImportingCsv} />
    </div>
  );
}
