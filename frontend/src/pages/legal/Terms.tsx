import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/AppFooter';
import { institutesApi } from '@/api/institutes';
import type { PublicInstitute } from '@/types';
import { TERMS_VERSION } from './policyVersions';

export default function Terms() {
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });
  const inst: PublicInstitute | null = data?.institute ?? null;

  const denomination = inst?.legalName?.trim() ?? inst?.name.trim() ?? "l'Istituto";
  const jurisdictionCity = inst?.jurisdictionCity?.trim() ?? inst?.city?.trim() ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Torna all'app
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">Versione {TERMS_VERSION}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-medium">Termini di servizio</h1>
        <p className="mt-2 text-muted-foreground">
          Condizioni d'uso dell'applicazione di prenotazione aule e prestito strumenti.
        </p>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">1. Oggetto</h2>
          <p>
            La presente piattaforma, gestita da <strong>{denomination}</strong>, consente al
            personale e agli iscritti di prenotare aule e richiedere il prestito di strumenti
            musicali, secondo i regolamenti interni dell'Istituto. L'uso del servizio è riservato ai
            soggetti autorizzati e approvati dall'amministrazione.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">2. Account e credenziali</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>L'utente è tenuto a fornire dati veritieri e a mantenerli aggiornati.</li>
            <li>Le credenziali sono personali e non cedibili a terzi.</li>
            <li>
              Ogni operazione effettuata con le credenziali dell'utente è imputata all'utente
              stesso.
            </li>
            <li>
              In caso di smarrimento o sospetto compromissione delle credenziali, è obbligo
              dell'utente avvisare immediatamente l'amministrazione.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">3. Regole d'uso</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Le prenotazioni devono rispettare le quote e le finestre temporali stabilite per
              ciascun ruolo.
            </li>
            <li>Non è ammessa la cessione di prenotazioni a terzi.</li>
            <li>
              L'utente si impegna a cancellare con anticipo le prenotazioni a cui non potrà
              partecipare.
            </li>
            <li>
              Ripetuti casi di no-show possono comportare la riduzione della quota disponibile.
            </li>
            <li>
              Per il prestito di strumenti l'utente è custode dello strumento e ne risponde in caso
              di danno o smarrimento secondo il regolamento dell'Istituto.
            </li>
            <li>
              È vietato qualunque tentativo di accesso non autorizzato, scraping massivo o uso
              automatizzato non consentito della piattaforma.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">4. Sospensione e revoca</h2>
          <p>
            In caso di violazione dei presenti termini o del regolamento interno, l'amministrazione
            può sospendere o revocare l'accesso al servizio, ferma restando l'eventuale segnalazione
            agli organi competenti.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">5. Limitazione di responsabilità</h2>
          <p>
            Il servizio è fornito "as is". Pur adottando misure di manutenzione e disaster recovery,
            l'Istituto non garantisce la continuità assoluta del servizio e non risponde di
            eventuali disservizi imputabili a cause di forza maggiore o a fornitori terzi (rete,
            energia, provider OAuth).
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">6. Modifiche ai termini</h2>
          <p>
            I presenti termini possono essere aggiornati. La versione in vigore è quella riportata
            in cima alla pagina. In caso di modifiche sostanziali sarà richiesta nuovamente
            l'accettazione al successivo accesso.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">7. Foro competente</h2>
          <p>
            Per qualsiasi controversia relativa all'interpretazione o all'esecuzione dei presenti
            termini è competente
            {jurisdictionCity ? (
              <>
                {' '}
                il foro di <strong>{jurisdictionCity}</strong>
              </>
            ) : (
              <> il foro nella cui circoscrizione ha sede l'Istituto</>
            )}
            , salvo diversa disposizione inderogabile di legge.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <p className="text-muted-foreground">
            Per il trattamento dei dati personali si rimanda all'
            <Link to="/privacy-policy" className="underline">
              Informativa sulla privacy
            </Link>
            .
          </p>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
