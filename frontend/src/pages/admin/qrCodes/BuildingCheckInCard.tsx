import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { qrcodesApi, type BuildingCheckInEntry } from '@/api/qrcodes';
import { httpErrorMessage } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { qk } from '@/lib/queryKeys';
import { invalidateQrStructure } from '@/lib/invalidation';

// =====================================================
// Card "Check-in per edificio" (impostazione generale)
// =====================================================
export function BuildingCheckInCard() {
  const qc = useQueryClient();
  const buildingsQuery = useQuery({
    queryKey: qk.admin.qrBuildings(),
    queryFn: () => qrcodesApi.listBuildingCheckIn(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      qrcodesApi.setBuildingCheckIn(id, enabled),
    onSuccess: ({ building }) => {
      toast.success(
        building.checkInDefault
          ? `Check-in attivato per ${building.name}`
          : `Check-in disattivato per ${building.name}`,
      );
      void invalidateQrStructure(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  if (buildingsQuery.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  const items = buildingsQuery.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          Check-in per edificio (impostazione generale)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Toggle generale per attivare il check-in QR di tutte le aule di un edificio.
          L&rsquo;impostazione singola sull&rsquo;aula (Eredita / Forza ON / Forza OFF) sovrascrive
          questa.
        </p>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Nessun edificio configurato.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Edificio</th>
                  <th className="px-3 py-2 text-right">Aule</th>
                  <th className="px-3 py-2 text-right">Override individuali</th>
                  <th className="px-3 py-2 text-right">Check-in attivo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <BuildingCheckInRow
                    key={b.id}
                    building={b}
                    isPending={toggleMutation.isPending && toggleMutation.variables.id === b.id}
                    onToggle={(enabled) => {
                      toggleMutation.mutate({ id: b.id, enabled });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BuildingCheckInRow({
  building,
  isPending,
  onToggle,
}: {
  building: BuildingCheckInEntry;
  isPending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="font-medium">{building.name}</div>
          {building.code && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {building.code}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{building.roomsTotal}</td>
      <td className="px-3 py-3 text-right">
        {building.roomsWithOverride > 0 ? (
          <Badge variant="secondary">{building.roomsWithOverride} con override</Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          {isPending && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          <Switch
            aria-label={`Toggle check-in per ${building.name}`}
            checked={building.checkInDefault}
            disabled={isPending}
            onCheckedChange={onToggle}
          />
        </div>
      </td>
    </tr>
  );
}
