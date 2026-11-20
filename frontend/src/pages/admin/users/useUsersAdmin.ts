import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { usersApi } from '@/api/users';
import { httpErrorMessage } from '@/lib/api';
import type { Role, User, UserStatus } from '@/types';
import { qk } from '@/lib/queryKeys';
import { invalidateUsers } from '@/lib/invalidation';

import { filterUsersBySearch } from '@/lib/userFilter';
import { VALID_USERS_TABS, type UsersTab } from './constants';

export function useUsersAdmin() {
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
    queryKey: qk.users.list({ role: roleFilter, active: activeFilter, status: statusFilter }),
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
      void invalidateUsers(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => usersApi.reject(id),
    onSuccess: () => {
      toast.success(t('admin.users.rejected_toast'));
      void invalidateUsers(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const filtered = useMemo(() => {
    return filterUsersBySearch(query.data?.users ?? [], search);
  }, [query.data, search]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => {
      toast.success(t('admin.users.deleted_toast'));
      void invalidateUsers(qc);
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
      void invalidateUsers(qc);
      setSelected(new Set());
      setBulkAction(null);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: () => usersApi.bulkDelete(Array.from(selected)),
    onSuccess: ({ deleted, removedBookings }) => {
      toast.success(t('admin.users.bulk.deleted_toast', { count: deleted, removedBookings }));
      void invalidateUsers(qc);
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
  return {
    currentUser,
    tab,
    handleTabChange,
    search,
    setSearch,
    roleFilter,
    setRoleFilter,
    activeFilter,
    setActiveFilter,
    statusFilter,
    setStatusFilter,
    editTarget,
    setEditTarget,
    creating,
    setCreating,
    importingCsv,
    setImportingCsv,
    deleteTarget,
    setDeleteTarget,
    deleteError,
    setDeleteError,
    selected,
    setSelected,
    bulkAction,
    setBulkAction,
    query,
    approveMutation,
    rejectMutation,
    deleteMutation,
    bulkApproveMutation,
    bulkDeleteMutation,
    bulkSetupLinksMutation,
    filtered,
    pendingSelected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
  };
}
