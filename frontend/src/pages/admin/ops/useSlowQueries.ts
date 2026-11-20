import { useQuery } from '@tanstack/react-query';
import { opsApi } from '@/api/ops';
import { qk } from '@/lib/queryKeys';

// Polling 60s — il ring buffer in-memory non cambia di colpo e la card
// è "diagnostica", non "live monitoring".
export const SLOW_QUERIES_REFETCH_INTERVAL_MS = 60_000;

export function useSlowQueries() {
  const aggregateQuery = useQuery({
    queryKey: qk.admin.opsSlowQueriesAggregateRoute(),
    queryFn: () => opsApi.slowQueriesAggregate({ by: 'route', since: '24h', limit: 10 }),
    refetchInterval: SLOW_QUERIES_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  const recentQuery = useQuery({
    queryKey: qk.admin.opsSlowQueriesRecent(),
    queryFn: () => opsApi.slowQueries({ limit: 10, since: '24h' }),
    refetchInterval: SLOW_QUERIES_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: false,
  });

  const stats = aggregateQuery.data?.stats ?? recentQuery.data?.stats;

  return { aggregateQuery, recentQuery, stats };
}
