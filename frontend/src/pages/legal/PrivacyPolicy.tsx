import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AppFooter } from '@/components/AppFooter';
import { institutesApi } from '@/api/institutes';
import type { PublicInstitute } from '@/types';
import { PRIVACY_POLICY_VERSION } from './policyVersions';

const MISSING = '[da configurare]';

function fmt(value: string | null | undefined) {
  return value?.trim() ? value : MISSING;
}

function MailLink({ email }: { email: string | null | undefined }) {
  if (!email?.trim()) return <span>{MISSING}</span>;
  return (
    <a href={`mailto:${email}`} className="underline">
      {email}
    </a>
  );
}

export default function PrivacyPolicy() {
  const { data } = useQuery({
    queryKey: ['institute', 'public'],
    queryFn: () => institutesApi.public(),
    staleTime: 5 * 60 * 1000,
  });
  const inst: PublicInstitute | null = data?.institute ?? null;

  const denomination =
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    fmt(inst?.legalName) !== MISSING ? inst!.legalName! : (inst?.name ?? MISSING);
  const fullAddress = [inst?.address, inst?.city, inst?.country]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join(', ');

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Torna all'app
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">Versione {PRIVACY_POLICY_VERSION}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 text-sm leading-relaxed">
        <h1 className="font-display text-3xl font-medium">Informativa sulla privacy</h1>
        <p className="mt-2 text-muted-foreground">
          Ai sensi degli articoli 13 e 14 del Regolamento (UE) 2016/679 (GDPR).
        </p>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">1. Titolare del trattamento</h2>
          <p>
            Il titolare del trattamento è <strong>{denomination}</strong>
            {fullAddress && <>, con sede in {fullAddress}</>}
            {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
            {fmt(inst?.vatNumber) !== MISSING && <>, P.IVA {inst!.vatNumber}</>}
            {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
            {fmt(inst?.fiscalCode) !== MISSING && <>, C.F. {inst!.fiscalCode}</>}.
          </p>
          {fmt(inst?.contactEmail) !== MISSING && (
            <p>
              Email di contatto: <MailLink email={inst?.contactEmail} />
              {fmt(inst?.pecEmail) !== MISSING && (
                <>
                  {' '}
                  — PEC: <MailLink email={inst?.pecEmail} />
                </>
              )}
              .
            </p>
          )}
          <p>
            <strong>Responsabile della Protezione dei Dati (DPO)</strong>: {fmt(inst?.dpoName)}
            {fmt(inst?.dpoEmail) !== MISSING && (
              <>
                {' '}
                — <MailLink email={inst?.dpoEmail} />
              </>
            )}
            .
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">2. Tipologie di dati trattati</h2>
          <p>L'applicazione tratta le seguenti categorie di dati personali:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Dati anagrafici e di contatto</strong>: nome, cognome, indirizzo email,
              eventuale matricola, ruolo (studente, docente, amministratore).
            </li>
            <li>
              <strong>Dati di autenticazione</strong>: password (memorizzata esclusivamente in forma
              di hash bcrypt), token OAuth se l'utente accede tramite Google o Microsoft.
            </li>
            <li>
              <strong>Dati di utilizzo del servizio</strong>: prenotazioni di aule, prestiti di
              strumenti, partecipazione a concerti.
            </li>
            <li>
              <strong>Dati tecnici</strong>: indirizzo IP, identificativo di sessione, user agent,
              log delle operazioni eseguite (Audit Log). Tali dati sono trattati ai fini della
              sicurezza informatica e della tracciabilità delle operazioni amministrative.
            </li>
          </ul>
          <p>
            Non vengono trattate categorie particolari di dati personali ai sensi dell'art. 9 GDPR
            (dati sanitari, religiosi, biometrici).
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">3. Finalità e basi giuridiche</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Finalità</th>
                <th className="py-2 text-left font-medium">Base giuridica</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-border/40">
              <tr>
                <td className="py-2 pr-3">
                  Erogazione del servizio di prenotazione aule e prestito strumenti
                </td>
                <td className="py-2">Art. 6.1.b — esecuzione di un contratto</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Gestione anagrafica didattica e dei ruoli</td>
                <td className="py-2">
                  Art. 6.1.e — interesse pubblico (istruzione di alta formazione musicale)
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Sicurezza informatica, audit log, prevenzione abusi</td>
                <td className="py-2">Art. 6.1.f — legittimo interesse</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Adempimenti regolamentari e contabili</td>
                <td className="py-2">Art. 6.1.c — obbligo legale</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Comunicazioni promozionali / newsletter</td>
                <td className="py-2">Art. 6.1.a — consenso esplicito (revocabile)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">
                  Bot messaging (Telegram / WhatsApp / Signal / Email): collegamento opt-in
                  canale↔account, gestione conversazioni di prenotazione
                </td>
                <td className="py-2">
                  Art. 6.1.b — esecuzione di un contratto su iniziativa esplicita dell'utente
                  (binding via OTP)
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">3.bis Bot messaging — trattamenti specifici</h2>
          <p>
            L'utente può, in modo <strong>volontario e opt-in</strong>, collegare il proprio account
            Cadenza a un bot conversazionale (Telegram, WhatsApp, Signal, Email IMAP) per prenotare
            aule via messaggio. Il collegamento avviene tramite un codice OTP a 6 caratteri generato
            dal profilo utente e inviato dall'utente stesso al bot.
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              <strong>Dati trattati</strong>: identificativo del canale (Telegram chat_id, numero
              WhatsApp/Signal, email), associazione con l'account Cadenza, contenuto dei messaggi
              inviati al bot (oggetto della prenotazione).
            </li>
            <li>
              <strong>Finalità</strong>: gestione delle richieste conversazionali di prenotazione,
              audit di sicurezza, prevenzione abusi.
            </li>
            <li>
              <strong>Conservazione</strong>: identificativo canale per tutta la durata del binding;
              messaggi nei log audit fino a 24 mesi; il binding è revocabile in ogni momento da
              Profilo → Bot messaging.
            </li>
            <li>
              <strong>Trasferimenti extra-UE</strong>: i canali Telegram, WhatsApp e Signal possono
              comportare il trasferimento di dati a fornitori al di fuori dell'UE
              (US/Russia/Svizzera). I trasferimenti avvengono sulla base di Standard Contractual
              Clauses (SCC) e/o EU-US Data Privacy Framework, dove applicabile. L'utente può
              scegliere di NON usare il canale e continuare a usare la web-app come prima.
            </li>
            <li>
              <strong>Bypass non consentiti</strong>: il bot rispetta le stesse regole di
              prenotazione (quote, finestre orarie, approvazione admin) della web-app; non c'è
              alcuna deroga.
            </li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">4. Periodi di conservazione</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Account utente: per tutta la durata dell'iscrizione e per i 30 giorni successivi alla
              richiesta di cancellazione.
            </li>
            <li>
              Prenotazioni e prestiti: 5 anni in forma identificata, oltre i quali i dati vengono
              anonimizzati e utilizzati solo a fini statistici aggregati.
            </li>
            <li>Audit log: massimo 24 mesi.</li>
            <li>Log applicativi e di accesso: 30-90 giorni.</li>
            <li>Backup cifrati: ruotati con retention massima di 90 giorni.</li>
          </ul>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">5. Destinatari e responsabili esterni</h2>
          <p>
            I dati possono essere comunicati a soggetti che operano come responsabili del
            trattamento ai sensi dell'art. 28 GDPR, sulla base di un contratto di nomina (DPA).
          </p>
          {Array.isArray(inst?.subProcessors) && inst.subProcessors.length > 0 ? (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Fornitore</th>
                  <th className="py-2 text-left font-medium">Finalità</th>
                  <th className="py-2 text-left font-medium">Localizzazione</th>
                  <th className="py-2 text-left font-medium">DPA</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-border/40">
                {inst.subProcessors.map((sp, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3">{sp.name}</td>
                    <td className="py-2 pr-3">{sp.purpose ?? '—'}</td>
                    <td className="py-2 pr-3">{sp.location ?? '—'}</td>
                    <td className="py-2">
                      {sp.dpaUrl ? (
                        <a href={sp.dpaUrl} target="_blank" rel="noreferrer" className="underline">
                          link
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-muted-foreground">
              L'elenco aggiornato dei sub-responsabili è disponibile su richiesta scritta al
              titolare.
            </p>
          )}
          <p>
            Eventuali trasferimenti di dati al di fuori dello Spazio Economico Europeo avvengono
            esclusivamente verso paesi che garantiscono un livello di protezione adeguato o sulla
            base delle Standard Contractual Clauses approvate dalla Commissione Europea.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">6. Diritti dell'interessato</h2>
          <p>
            L'interessato può esercitare in qualsiasi momento i diritti previsti dagli articoli
            15-22 del GDPR:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Accesso ai dati e copia degli stessi.</li>
            <li>Rettifica di dati inesatti o incompleti.</li>
            <li>Cancellazione (diritto all'oblio), nei limiti consentiti dalla legge.</li>
            <li>Limitazione del trattamento.</li>
            <li>Portabilità dei dati in formato strutturato.</li>
            <li>Opposizione al trattamento basato su legittimo interesse.</li>
            <li>
              Revoca del consenso, senza pregiudizio della liceità dei trattamenti effettuati prima
              della revoca.
            </li>
          </ul>
          <p>
            Le richieste possono essere inoltrate dalla pagina{' '}
            <Link to="/profile" className="underline">
              Profilo
            </Link>{' '}
            o via email al DPO ({<MailLink email={inst?.dpoEmail} />}). Il riscontro è fornito entro
            30 giorni.
          </p>
          <p>
            È inoltre riconosciuto il diritto di proporre reclamo all'Autorità Garante per la
            protezione dei dati personali (
            <a
              href="https://www.garanteprivacy.it"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              garanteprivacy.it
            </a>
            ).
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">7. Cookie e tecnologie simili</h2>
          <p>
            L'applicazione utilizza esclusivamente cookie tecnici e di sessione necessari al
            funzionamento del servizio (autenticazione, preferenze interfaccia, lingua). Per tali
            cookie non è richiesto il consenso ai sensi del provvedimento del Garante del 10 giugno
            2021. Eventuali cookie di analisi o di terze parti vengono attivati solo previo consenso
            esplicito tramite l'apposito banner.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">8. Misure di sicurezza</h2>
          <p>
            Sono adottate misure tecniche e organizzative adeguate al rischio (art. 32 GDPR):
            trasmissione cifrata in TLS, hashing delle password con bcrypt, controllo degli accessi
            basato su ruoli, audit log delle operazioni amministrative, rate limiting sugli endpoint
            sensibili, backup cifrati, redact delle informazioni personali nei log applicativi.
          </p>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="font-display text-xl">9. Modifiche all'informativa</h2>
          <p>
            La presente informativa può essere aggiornata. La versione in vigore è identificata
            dalla data riportata in alto. In caso di modifiche sostanziali verrà richiesto un nuovo
            consenso al successivo accesso.
          </p>
        </section>
      </main>

      <AppFooter />
    </div>
  );
}
