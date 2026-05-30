import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  ShieldX,
  Trash2,
  Upload,
  Users as UsersIcon,
  UserX,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usersApi } from '@/api/users';
import {
  oauthSettingsApi,
  SECRET_PLACEHOLDER,
  type UpsertOAuthSettings,
} from '@/api/oauthSettings';
import { httpErrorMessage } from '@/lib/api';
import { UsersCsvImportDialog } from '@/components/admin/UsersCsvImportDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { UserFormDialog } from '@/components/admin/UserFormDialog';
import { ConfirmDeleteDialog } from '@/components/admin/ConfirmDeleteDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { IsidataImportContent } from '@/pages/admin/integrations/IsidataImport';
import { IsidataLogo } from '@/components/icons/IsidataLogo';
import { Esse3Logo } from '@/components/icons/Esse3Logo';
import type { Role, User, UserStatus } from '@/types';

// I label di Role/Status sono ora chiavi i18n; risolvile con t() nel render.
const ROLE_LABEL_KEY: Record<Role, string> = {
  admin: 'roles.admin_short',
  docente: 'roles.docente_short',
  studente: 'roles.studente_short',
};

const ROLE_VARIANT: Record<Role, 'default' | 'secondary' | 'muted'> = {
  admin: 'default',
  docente: 'secondary',
  studente: 'muted',
};

const STATUS_LABEL_KEY: Record<UserStatus, string> = {
  pending: 'user_status.pending',
  approved: 'user_status.approved',
  rejected: 'user_status.rejected',
};

type UsersTab = 'users' | 'sso';
const VALID_USERS_TABS: UsersTab[] = ['users', 'sso'];

export default function AdminUsers() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  // Tab attivo persistito in ?tab= (deep-link friendly). Default: "users".
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as UsersTab | null;
  const tab: UsersTab =
    requestedTab && VALID_USERS_TABS.includes(requestedTab) ? requestedTab : 'users';
  useEffect(() => {
    if (requestedTab !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [requestedTab, tab, searchParams, setSearchParams]);
  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: false });
  };

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Bulk selection (su utenti pending). Reset al cambio filtro.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<
    'approve' | 'reject' | 'delete' | 'setup_link' | null
  >(null);

  const query = useQuery({
    queryKey: ['users', { role: roleFilter, active: activeFilter, status: statusFilter }],
    queryFn: () =>
      usersApi.list({
        role: roleFilter === 'all' ? undefined : (roleFilter as Role),
        active: activeFilter === 'all' ? undefined : activeFilter === 'true',
        status: statusFilter === 'all' ? undefined : (statusFilter as UserStatus),
      }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => usersApi.approve(id),
    onSuccess: () => {
      toast.success(t('admin.users.approved_toast'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => usersApi.reject(id),
    onSuccess: () => {
      toast.success(t('admin.users.rejected_toast'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return query.data?.users ?? [];
    return (query.data?.users ?? []).filter((u) => {
      return (
        [u.firstName, u.lastName, u.email, u.matricola, u.course?.name]
          .filter(Boolean)
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          .some((v) => v!.toLowerCase().includes(term))
      );
    });
  }, [query.data, search]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.users.deleted_toast'));
      void qc.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      setDeleteError(httpErrorMessage(err));
    },
  });

  // Reset selezione quando cambiano filtri o lista
  useEffect(() => {
    setSelected(new Set());
  }, [roleFilter, statusFilter, activeFilter]);

  // Solo gli utenti pending possono essere bulk-approve/reject
  const pendingSelected = useMemo(
    () => filtered.filter((u) => selected.has(u.id) && u.status === 'pending'),
    [filtered, selected],
  );
  const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  const someSelected = filtered.some((u) => selected.has(u.id)) && !allSelected;
  const toggleAll = (checked: boolean) => {
    setSelected(
      checked
        ? new Set(filtered.filter((u) => u.id !== currentUser?.id).map((u) => u.id))
        : new Set(),
    );
  };
  const toggleOne = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const bulkApproveMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      usersApi.bulkApprove(Array.from(selected), action),
    onSuccess: ({ changed, skipped }, action) => {
      toast.success(
        t(
          action === 'approve'
            ? 'admin.users.bulk.approved_toast'
            : 'admin.users.bulk.rejected_toast',
          { count: changed, skipped },
        ),
      );
      void qc.invalidateQueries({ queryKey: ['users'] });
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => usersApi.bulkDelete(Array.from(selected)),
    onSuccess: ({ deleted, removedBookings }) => {
      toast.success(t('admin.users.bulk.deleted_toast', { count: deleted, removedBookings }));
      void qc.invalidateQueries({ queryKey: ['users'] });
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Invio massivo del magic-link "imposta password" agli utenti selezionati.
  // Il backend skippa automaticamente chi ha già una password (onlyMissingPassword:
  // true di default). Riportiamo nel toast il delta sent/skipped.
  const bulkSetupLinksMutation = useMutation({
    mutationFn: () =>
      usersApi.sendSetupLinksBulk({
        userIds: Array.from(selected),
        onlyMissingPassword: true,
      }),
    onSuccess: ({ sent, skipped }) => {
      toast.success(t('admin.users.bulk.setup_links_sent_toast', { sent, skipped }));
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const blob = await usersApi.downloadCsv();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `utenti-${new Date().toISOString().slice(0, 10)}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
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

          <Card>
            <CardContent className="grid gap-3 p-4 sm:p-6 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                  placeholder={t('admin.users.search_placeholder')}
                  className="pl-9"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.users.all_roles')}</SelectItem>
                  <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                  <SelectItem value="docente">{t('roles.docente')}</SelectItem>
                  <SelectItem value="studente">{t('roles.studente')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.users.all_statuses')}</SelectItem>
                  <SelectItem value="pending">{t('user_status.pending')}</SelectItem>
                  <SelectItem value="approved">{t('user_status.approved')}</SelectItem>
                  <SelectItem value="rejected">{t('user_status.rejected')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="md:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.users.all_active')}</SelectItem>
                  <SelectItem value="true">{t('admin.users.active_yes')}</SelectItem>
                  <SelectItem value="false">{t('admin.users.active_no')}</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selected.size > 0 && (
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
          )}

          <Card>
            {/* Tabella utenti scrollabile internamente: oltre i ~10 utenti
            visibili la lista scorre dentro il card senza far crescere la
            pagina (la sezione OAuth/Isidata in fondo resta sempre visibile).
            sticky thead per non perdere il riferimento delle colonne. */}
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-b bg-muted/95 text-left text-xs uppercase tracking-wider text-muted-foreground backdrop-blur-sm supports-backdrop-filter:bg-muted/70">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <Checkbox
                        checked={allSelected || (someSelected ? 'indeterminate' : false)}
                        onCheckedChange={(v) => {
                          toggleAll(v === true);
                        }}
                        aria-label={t('common.select')}
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.user')}</th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.role')}</th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.matricola')}</th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.course')}</th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.approval')}</th>
                    <th className="px-4 py-3 font-medium">{t('admin.users.table.status')}</th>
                    <th className="px-4 py-3 font-medium text-right">
                      {t('admin.users.table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.isLoading &&
                    [0, 1, 2, 3].map((i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-3" colSpan={8}>
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))}
                  {!query.isLoading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <UserX className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">{t('admin.users.empty.title')}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('admin.users.empty.subtitle')}
                        </p>
                      </td>
                    </tr>
                  )}
                  {filtered.map((u) => (
                    <motion.tr
                      key={u.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selected.has(u.id)}
                          onCheckedChange={(v) => {
                            toggleOne(u.id, v === true);
                          }}
                          disabled={u.id === currentUser?.id}
                          aria-label={t('common.select')}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            {u.profilePhotoUrl && <AvatarImage src={u.profilePhotoUrl} alt="" />}
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {`${u.firstName[0]}${u.lastName[0]}`}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {u.firstName} {u.lastName}
                              {currentUser?.id === u.id && (
                                <span className="ml-2 text-[10px] uppercase text-primary">
                                  {t('admin.users.you_label')}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={ROLE_VARIANT[u.role]}>
                          {u.role === 'admin' && <ShieldCheck className="mr-1 h-3 w-3" />}
                          {t(ROLE_LABEL_KEY[u.role])}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.matricola ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.course ? `${u.course.code} — ${u.course.name}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {u.role === 'admin' ? (
                          <Badge variant="success">
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            {t(STATUS_LABEL_KEY.approved)}
                          </Badge>
                        ) : u.status === 'approved' ? (
                          <Badge variant="success">
                            <Check className="mr-1 h-3 w-3" />
                            {t(STATUS_LABEL_KEY.approved)}
                          </Badge>
                        ) : u.status === 'rejected' ? (
                          <Badge variant="muted" className="text-destructive">
                            <ShieldX className="mr-1 h-3 w-3" />
                            {t(STATUS_LABEL_KEY.rejected)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <Clock className="mr-1 h-3 w-3" />
                            {t(STATUS_LABEL_KEY.pending)}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.isActive ? 'success' : 'muted'}>
                          {u.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {u.role !== 'admin' && u.status === 'pending' && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('admin.users.approve')}
                                disabled={approveMutation.isPending}
                                onClick={() => {
                                  approveMutation.mutate(u.id);
                                }}
                                className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('admin.users.reject')}
                                disabled={rejectMutation.isPending}
                                onClick={() => {
                                  rejectMutation.mutate(u.id);
                                }}
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.edit')}
                            onClick={() => {
                              setEditTarget(u);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.delete')}
                            disabled={currentUser?.id === u.id}
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(u);
                            }}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
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

// =====================================================
// Tab "SSO": configurazione provider OAuth (Google/Microsoft), whitelist
// domini email consentiti al login OAuth e importazione anagrafica Isidata.
// I secret sono cifrati a DB; in UI mostriamo solo lo stato "configurato"
// e un campo per inserirne uno nuovo. Provider ID/secret/callback richiedono
// riavvio del backend; la whitelist domini ha invece effetto immediato
// (verificata a ogni login OAuth via DB read).
// =====================================================
interface OAuthFormState {
  // Google
  googleEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string; // SECRET_PLACEHOLDER finché non modificato
  googleCallbackUrl: string;
  // Microsoft
  microsoftEnabled: boolean;
  microsoftClientId: string;
  microsoftClientSecret: string;
  microsoftCallbackUrl: string;
  microsoftTenant: string;
  // Whitelist domini (CSV editabile dall'admin)
  allowedEmailDomains: string;
}

function SsoTabContent() {
  const qc = useQueryClient();
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showMsSecret, setShowMsSecret] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const query = useQuery({
    queryKey: ['admin', 'oauth-settings'],
    queryFn: () => oauthSettingsApi.get(),
  });

  const [form, setForm] = useState<OAuthFormState | null>(null);
  const [initial, setInitial] = useState<OAuthFormState | null>(null);

  useEffect(() => {
    if (query.data) {
      const s = query.data.settings;
      const next: OAuthFormState = {
        googleEnabled: s.googleEnabled,
        googleClientId: s.googleClientId,
        googleClientSecret: s.googleClientSecretSet ? SECRET_PLACEHOLDER : '',
        googleCallbackUrl: s.googleCallbackUrl,
        microsoftEnabled: s.microsoftEnabled,
        microsoftClientId: s.microsoftClientId,
        microsoftClientSecret: s.microsoftClientSecretSet ? SECRET_PLACEHOLDER : '',
        microsoftCallbackUrl: s.microsoftCallbackUrl,
        microsoftTenant: s.microsoftTenant || 'common',
        allowedEmailDomains: s.allowedEmailDomainsList.join(', '),
      };
      setForm(next);
      setInitial(next);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (payload: UpsertOAuthSettings) => oauthSettingsApi.update(payload),
    onSuccess: (data) => {
      toast.success('Impostazioni OAuth salvate');
      void qc.invalidateQueries({ queryKey: ['admin', 'oauth-settings'] });
      // restartRequired = false solo se ho toccato esclusivamente la whitelist.
      if (data.restartRequired) setRestartHint(true);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  // Anteprima domini normalizzati: utile per dare un feedback all'utente che
  // virgole/spazi/case verranno comunque ripuliti lato server. Calcolato prima
  // dell'early return per rispettare le regole degli hook (no chiamate condizionali).
  const rawDomainsInput = form?.allowedEmailDomains ?? '';
  const normalizedDomains = useMemo(
    () =>
      Array.from(
        new Set(
          rawDomainsInput
            .split(/[,\s;]+/)
            .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
            .filter(Boolean),
        ),
      ),
    [rawDomainsInput],
  );

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Impossibile caricare le impostazioni SSO: {httpErrorMessage(query.error)}. Verifica che il
          backend sia stato riavviato dopo l'ultimo aggiornamento.
        </AlertDescription>
      </Alert>
    );
  }
  if (query.isLoading || !form || !initial) {
    return <Skeleton className="h-72 w-full" />;
  }

  const isGoogleDirty =
    form.googleEnabled !== initial.googleEnabled ||
    form.googleClientId !== initial.googleClientId ||
    form.googleClientSecret !== initial.googleClientSecret ||
    form.googleCallbackUrl !== initial.googleCallbackUrl;

  const isMsDirty =
    form.microsoftEnabled !== initial.microsoftEnabled ||
    form.microsoftClientId !== initial.microsoftClientId ||
    form.microsoftClientSecret !== initial.microsoftClientSecret ||
    form.microsoftCallbackUrl !== initial.microsoftCallbackUrl ||
    form.microsoftTenant !== initial.microsoftTenant;

  const isDomainsDirty = form.allowedEmailDomains !== initial.allowedEmailDomains;

  const saveGoogle = () => {
    mutation.mutate({
      googleEnabled: form.googleEnabled,
      googleClientId: form.googleClientId.trim(),
      googleClientSecret: form.googleClientSecret,
      googleCallbackUrl: form.googleCallbackUrl.trim(),
    });
  };

  const saveMicrosoft = () => {
    mutation.mutate({
      microsoftEnabled: form.microsoftEnabled,
      microsoftClientId: form.microsoftClientId.trim(),
      microsoftClientSecret: form.microsoftClientSecret,
      microsoftCallbackUrl: form.microsoftCallbackUrl.trim(),
      microsoftTenant: form.microsoftTenant.trim() || 'common',
    });
  };

  const saveDomains = () => {
    // Inviamo l'array già normalizzato (il backend ri-normalizza comunque).
    mutation.mutate({ allowedEmailDomains: normalizedDomains });
  };

  return (
    <div className="space-y-4">
      {restartHint && (
        <Alert variant="info">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Riavvia il backend per applicare le nuove impostazioni OAuth (client ID, secret,
            callback, tenant). La whitelist domini è invece già attiva.
          </AlertDescription>
        </Alert>
      )}

      {/* DOMINI CONSENTITI: card full-width in cima. Si applica sia a Google
          che a Microsoft. Lista vuota = nessuna restrizione (qualunque
          account OAuth viene accettato). Modifiche immediate, no riavvio. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
            <span className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Domini email consentiti
            </span>
            {normalizedDomains.length === 0 ? (
              <Badge variant="muted">Nessuna restrizione</Badge>
            ) : (
              <Badge variant="secondary">
                {normalizedDomains.length} domin{normalizedDomains.length === 1 ? 'io' : 'i'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 sm:pt-0">
          <p className="text-sm text-muted-foreground">
            Limita il login Google/Microsoft agli utenti la cui email appartiene a uno dei domini
            indicati. Lascia vuoto per accettare qualunque account.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="allowed-domains">
              Domini autorizzati (separati da virgola o spazio)
            </Label>
            <Input
              id="allowed-domains"
              value={form.allowedEmailDomains}
              onChange={(e) => {
                setForm({ ...form, allowedEmailDomains: e.target.value });
              }}
              placeholder="studenti.unimi.it, docenti.unimi.it"
            />
          </div>
          {normalizedDomains.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {normalizedDomains.map((d) => (
                <Badge key={d} variant="secondary" className="font-mono text-xs">
                  @{d}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted-foreground">
              Match esatto, case-insensitive. Le modifiche hanno effetto al prossimo login.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={saveDomains}
              disabled={!isDomainsDirty || mutation.isPending}
            >
              {mutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salva domini
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* GOOGLE */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
              <span className="flex items-center gap-2">
                <GoogleBadge />
                Google OAuth
              </span>
              <Switch
                checked={form.googleEnabled}
                onCheckedChange={(v) => {
                  setForm({ ...form, googleEnabled: v });
                }}
                aria-label="Abilita Google OAuth"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 sm:pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="g-cid">Client ID</Label>
              <Input
                id="g-cid"
                value={form.googleClientId}
                onChange={(e) => {
                  setForm({ ...form, googleClientId: e.target.value });
                }}
                placeholder="xxxxxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="g-cs" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Client Secret
                </Label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShowGoogleSecret((s) => !s);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showGoogleSecret ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Input
                id="g-cs"
                type={showGoogleSecret ? 'text' : 'password'}
                value={
                  form.googleClientSecret === SECRET_PLACEHOLDER ? '' : form.googleClientSecret
                }
                placeholder={
                  form.googleClientSecret === SECRET_PLACEHOLDER
                    ? '•••••••• (configurato — lascia vuoto per non modificare)'
                    : 'Inserisci il Client Secret'
                }
                onChange={(e) => {
                  setForm({ ...form, googleClientSecret: e.target.value });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-cb">Callback URL</Label>
              <Input
                id="g-cb"
                value={form.googleCallbackUrl}
                onChange={(e) => {
                  setForm({ ...form, googleCallbackUrl: e.target.value });
                }}
                placeholder="https://tuodominio/api/auth/google/callback"
              />
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                onClick={saveGoogle}
                disabled={!isGoogleDirty || mutation.isPending}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* MICROSOFT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
              <span className="flex items-center gap-2">
                <MicrosoftBadge />
                Microsoft OAuth
              </span>
              <Switch
                checked={form.microsoftEnabled}
                onCheckedChange={(v) => {
                  setForm({ ...form, microsoftEnabled: v });
                }}
                aria-label="Abilita Microsoft OAuth"
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 sm:pt-0">
            <div className="space-y-1.5">
              <Label htmlFor="m-cid">Client ID (Application ID)</Label>
              <Input
                id="m-cid"
                value={form.microsoftClientId}
                onChange={(e) => {
                  setForm({ ...form, microsoftClientId: e.target.value });
                }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="m-cs" className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Client Secret
                </Label>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setShowMsSecret((s) => !s);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showMsSecret ? (
                    <EyeOff className="inline h-3.5 w-3.5" />
                  ) : (
                    <Eye className="inline h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <Input
                id="m-cs"
                type={showMsSecret ? 'text' : 'password'}
                value={
                  form.microsoftClientSecret === SECRET_PLACEHOLDER
                    ? ''
                    : form.microsoftClientSecret
                }
                placeholder={
                  form.microsoftClientSecret === SECRET_PLACEHOLDER
                    ? '•••••••• (configurato — lascia vuoto per non modificare)'
                    : 'Inserisci il Client Secret'
                }
                onChange={(e) => {
                  setForm({ ...form, microsoftClientSecret: e.target.value });
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="m-tenant">Tenant</Label>
                <Input
                  id="m-tenant"
                  value={form.microsoftTenant}
                  onChange={(e) => {
                    setForm({ ...form, microsoftTenant: e.target.value });
                  }}
                  placeholder="common"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="m-cb">Callback URL</Label>
                <Input
                  id="m-cb"
                  value={form.microsoftCallbackUrl}
                  onChange={(e) => {
                    setForm({ ...form, microsoftCallbackUrl: e.target.value });
                  }}
                  placeholder="https://tuodominio/api/auth/microsoft/callback"
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                type="button"
                size="sm"
                onClick={saveMicrosoft}
                disabled={!isMsDirty || mutation.isPending}
              >
                {mutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salva
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ISIDATA: import anagrafica via XLSX/CSV. La card è un punto
            d'ingresso compatto: il wizard completo (drop file → preview →
            apply) si apre dentro un Dialog modale (vedi IsidataImportCard). */}
        <IsidataImportCard />

        {/* ESSE3 (CINECA): stesso wizard, parametrizzato sul `source`. Riusa
            l'engine Isidata con alias header CINECA (CodiceCdS, DescrizioneCdS,
            StatoIscrizione) ed externalSource='esse3' separato. */}
        <Esse3ImportCard />
      </div>
    </div>
  );
}

// =====================================================
// Card "import Isidata" — entry-point compatto verso il wizard completo.
//
// Il wizard di upload+preview+apply vive nel componente IsidataImportContent
// (riusato da /admin/integrations/isidata come pagina diretta). Qui dentro
// la card mostra solo titolo, descrizione e bottone "Apri importazione" che
// apre un Dialog modale con il wizard. Pattern coerente con le altre card
// "azione" della pagina (es. "Importa CSV utenti").
// =====================================================
function IsidataImportCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
            <span className="flex items-center gap-2">
              <IsidataLogo className="h-6 w-6" />
              Isidata
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0 sm:pt-0">
          <p className="text-sm text-muted-foreground">{t('integrations.isidata.subtitle')}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· XLSX o CSV, max 10 MB / 5000 record</li>
            <li>· Anteprima diff prima dell'apply (no side-effect)</li>
            <li>· Soft-disable utenti orfani (nessuna cancellazione)</li>
          </ul>
          <Button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            className="w-full"
          >
            <Upload className="h-4 w-4" />
            {t('integrations.isidata.preview_action')}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IsidataLogo className="h-7 w-7 shrink-0" />
              {t('integrations.isidata.title')}
            </DialogTitle>
            <DialogDescription>{t('integrations.isidata.subtitle')}</DialogDescription>
          </DialogHeader>
          <IsidataImportContent />
        </DialogContent>
      </Dialog>
    </>
  );
}

// =====================================================
// Card "import ESSE3" — gemella di IsidataImportCard ma chiama l'engine
// con source='esse3'. Pensata per i conservatori che usano la Suite Studenti
// CINECA (ESSE3 + UP) come sistema di segreteria: Cadenza importa l'export
// standard ESSE3 (Matricola, CodiceCdS, StatoIscrizione, ...) e mantiene
// gli utenti separati dal pool Isidata (externalSource='esse3').
// =====================================================
function Esse3ImportCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3 font-display text-lg">
            <span className="flex items-center gap-2">
              <Esse3Logo className="h-6 w-6" />
              ESSE3 (CINECA)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0 sm:pt-0">
          <p className="text-sm text-muted-foreground">
            Import anagrafica dagli export standard ESSE3 CINECA. Riconosce header "CodiceCdS",
            "DescrizioneCdS", "StatoIscrizione" e mappa gli stati "Laureato/Trasferito/Cessato" come
            utenti disattivati.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· XLSX o CSV, max 10 MB / 5000 record</li>
            <li>· Anteprima diff prima dell'apply (no side-effect)</li>
            <li>· Storico run separato dal pool Isidata</li>
          </ul>
          <Button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            className="w-full"
          >
            <Upload className="h-4 w-4" />
            Apri importazione ESSE3
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Esse3Logo className="h-7 w-7 shrink-0" />
              Importazione ESSE3 (CINECA)
            </DialogTitle>
            <DialogDescription>
              Carica l'export standard ESSE3 (CSV o XLSX). Il sistema riconosce automaticamente gli
              header tipici della Suite Studenti AFAM.
            </DialogDescription>
          </DialogHeader>
          <IsidataImportContent source="esse3" />
        </DialogContent>
      </Dialog>
    </>
  );
}

const GoogleBadge = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
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

const MicrosoftBadge = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
    <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
    <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
  </svg>
);
