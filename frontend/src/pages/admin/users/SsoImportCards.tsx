import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

// =====================================================
// Card "import Isidata" — entry-point compatto verso il wizard completo.
//
// Il wizard di upload+preview+apply vive nel componente IsidataImportContent
// (riusato da /admin/integrations/isidata come pagina diretta). Qui dentro
// la card mostra solo titolo, descrizione e bottone "Apri importazione" che
// apre un Dialog modale con il wizard. Pattern coerente con le altre card
// "azione" della pagina (es. "Importa CSV utenti").
// =====================================================
export function IsidataImportCard() {
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
export function Esse3ImportCard() {
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
