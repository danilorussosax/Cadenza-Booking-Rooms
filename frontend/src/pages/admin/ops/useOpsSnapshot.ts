import { useQuery } from '@tanstack/react-query';
import { opsApi } from '@/api/ops';
import { qk } from '@/lib/queryKeys';

// Polling 10s. Il backend ha già memoization 5s → al massimo una query reale
// ogni 10s anche con più admin connessi insieme.
export const OPS_REFETCH_INTERVAL_MS = 10_000;

export function useOpsSnapshot() {
  return useQuery({
    queryKey: qk.admin.opsSnapshot(),
    queryFn: () => opsApi.snapshot(),
    refetchInterval: OPS_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
}
