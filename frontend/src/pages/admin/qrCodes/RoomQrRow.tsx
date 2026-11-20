import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { qrcodesApi, type QrRoomEntry } from '@/api/qrcodes';
import { httpErrorMessage } from '@/lib/api';
import { dayjs } from '@/lib/date';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { qk } from '@/lib/queryKeys';

export function RoomQrRow({
  room,
  version,
  isPending,
  onRegenerate,
}: {
  room: QrRoomEntry;
  version: string | null;
  isPending: boolean;
  onRegenerate: () => void;
}) {
  const imageQuery = useQuery({
    queryKey: qk.admin.roomQr(room.id, version),
    queryFn: () => qrcodesApi.image(room.id, version),
    // Logo, sede e intervallo possono cambiare anche con lo stesso token QR.
    staleTime: 0,
  });
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (!imageQuery.data) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageQuery.data);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageQuery.data]);

  const downloadQr = () => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `qr-${room.code ?? room.id}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center">
        <div className="flex h-56 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1">
          {imageQuery.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-label="Caricamento QR" />
          ) : imageQuery.isError ? (
            <Button
              variant="ghost"
              size="sm"
              title={httpErrorMessage(imageQuery.error)}
              onClick={() => void imageQuery.refetch()}
            >
              Riprova
            </Button>
          ) : imageUrl ? (
            <button
              type="button"
              className="h-full w-full cursor-zoom-in"
              aria-label={`Ingrandisci cartello QR ${room.name}`}
              onClick={() => setPreviewOpen(true)}
            >
              <img
                src={imageUrl}
                alt={`QR ${room.name}`}
                className="h-full w-full object-contain"
              />
            </button>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">
              {room.code ? <span className="font-mono">{room.code}</span> : room.name}
            </p>
            {room.code && (
              <span className="truncate text-sm text-muted-foreground">{room.name}</span>
            )}
            <CheckInStateBadge
              inherited={room.inheritedFromBuilding}
              explicit={room.requireCheckIn}
              effective={room.effectiveCheckIn}
            />
            {!room.hasQrToken && !imageQuery.data && (
              <Badge variant="secondary">Token mai generato</Badge>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {room.building && (
              <>
                <Building2 className="h-3 w-3" />
                {room.building.name}
                {' · '}
              </>
            )}
            {room.qrTokenUpdatedAt
              ? `Ultima rigenerazione ${dayjs(room.qrTokenUpdatedAt).format('D MMM YYYY HH:mm')}`
              : 'Generato automaticamente al caricamento'}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadQr}
            disabled={!imageUrl || imageQuery.isPending || imageQuery.isError || isPending}
            title="Scarica PNG"
          >
            <Download className="h-4 w-4" />
            Scarica
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isPending}
            title="Rigenera token e invalida QR esistente"
          >
            {isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Rigenera
          </Button>
        </div>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Cartello QR — {room.name}</DialogTitle>
            <DialogDescription>
              Scarica il PNG e stampa il cartello da esporre all’ingresso dell’aula.
            </DialogDescription>
          </DialogHeader>
          {imageUrl && (
            <img
              src={imageUrl}
              alt={`Cartello QR ${room.name}`}
              className="mx-auto max-h-[70vh] w-auto object-contain"
            />
          )}
          <Button
            onClick={downloadQr}
            disabled={!imageUrl || imageQuery.isPending || imageQuery.isError || isPending}
          >
            Scarica PNG per la stampa
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Badge a 3 stati per il check-in di un'aula.
 *   - "Eredita (attivo|disattivo)" → l'aula non ha override, segue Building
 *   - "Sì"  → override esplicito true
 *   - "No"  → override esplicito false
 */
function CheckInStateBadge({
  inherited,
  explicit,
  effective,
}: {
  inherited: boolean;
  explicit: boolean | null;
  effective: boolean;
}) {
  if (inherited) {
    return <Badge variant="muted">Eredita ({effective ? 'attivo' : 'disattivo'})</Badge>;
  }
  if (explicit === true) return <Badge variant="success">Check-in attivo</Badge>;
  return <Badge variant="muted">Check-in non richiesto</Badge>;
}
