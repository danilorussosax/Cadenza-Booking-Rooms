import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { qrcodesApi } from '@/api/qrcodes';
import { httpErrorMessage } from '@/lib/api';
import { todayLocalIso } from '@/lib/date';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { qk } from '@/lib/queryKeys';
import { invalidateQrOverview } from '@/lib/invalidation';
import { saveBlob } from '@/lib/download';
import { RoomQrRow } from './RoomQrRow';

// =====================================================
// 2) Tabella QR-code per aula
// =====================================================
export function RoomsQrTable() {
  const qc = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: qk.admin.qrOverview(),
    queryFn: () => qrcodesApi.overview(),
  });

  // Cache-buster per forzare il browser a ricaricare il PNG dopo regenerate.
  const [versions, setVersions] = useState<Record<number, string>>({});

  const regenerateMutation = useMutation({
    mutationFn: (roomId: number) => qrcodesApi.regenerate(roomId),
    onSuccess: (data) => {
      toast.success('QR-code rigenerato. Stampa la nuova versione e sostituisci la copia in aula.');
      setVersions((prev) => ({ ...prev, [data.roomId]: data.qrTokenUpdatedAt }));
      void invalidateQrOverview(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const bulkMutation = useMutation({
    mutationFn: () => qrcodesApi.bulkRegenerate(),
    onSuccess: (data) => {
      toast.success(`Rigenerati ${data.updated} QR-code`);
      const ts = new Date().toISOString();
      setVersions(() => {
        const next: Record<number, string> = {};
        for (const r of overviewQuery.data?.rooms ?? []) next[r.id] = ts;
        return next;
      });
      void invalidateQrOverview(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const downloadAllMutation = useMutation({
    mutationFn: () => qrcodesApi.downloadAll(),
    onSuccess: (blob) => {
      saveBlob(blob, `qr-aule-${todayLocalIso()}.zip`);
      void invalidateQrOverview(qc);
    },
    onError: (err) => toast.error(httpErrorMessage(err)),
  });

  const rooms = useMemo(() => overviewQuery.data?.rooms ?? [], [overviewQuery.data]);

  if (overviewQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (overviewQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{httpErrorMessage(overviewQuery.error)}</AlertDescription>
        <Button variant="outline" onClick={() => void overviewQuery.refetch()}>
          Riprova
        </Button>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>QR-code per aula</CardTitle>
          <p className="text-sm text-muted-foreground">
            Ogni aula ha un cartello con logo, sede, aula e istruzioni per il check-in. Scarica il
            PNG di un'aula o tutti insieme in un file ZIP. La rigenerazione invalida tutti i QR
            fisici stampati prima.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadAllMutation.mutate()}
            disabled={downloadAllMutation.isPending || rooms.length === 0}
          >
            {downloadAllMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Scarica tutti (ZIP)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  'Rigenerare i QR-code di TUTTE le aule?\nDovrai ristampare e sostituire ogni QR fisico.',
                )
              ) {
                bulkMutation.mutate();
              }
            }}
            disabled={bulkMutation.isPending || rooms.length === 0}
          >
            {bulkMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Rigenera tutti
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 sm:pt-0">
        {rooms.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            Nessuna aula configurata.
          </div>
        ) : (
          <div className="space-y-3">
            {rooms.map((room) => (
              <RoomQrRow
                key={room.id}
                room={room}
                version={versions[room.id] ?? room.qrTokenUpdatedAt}
                isPending={regenerateMutation.isPending && regenerateMutation.variables === room.id}
                onRegenerate={() => {
                  if (
                    window.confirm(
                      `Rigenerare il QR di "${room.name}"?\nIl QR fisico esistente smetterà di funzionare.`,
                    )
                  ) {
                    regenerateMutation.mutate(room.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
