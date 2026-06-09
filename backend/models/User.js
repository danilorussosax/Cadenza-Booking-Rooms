'use strict';

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

// Cost factor per bcrypt. 12 è il default di sicurezza nel 2026
// (resistenza a brute-force GPU vs latenza di login ~250ms su hardware tipico).
// Sovrascrivibile via env per test (es. BCRYPT_COST=4 nei test unit).
const BCRYPT_COST = Math.max(4, Math.min(15, Number(process.env.BCRYPT_COST) || 12));

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      email: {
        type: DataTypes.STRING(190),
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: true, // null se l'utente si registra solo via OAuth
      },
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM('admin', 'docente', 'studente'),
        allowNull: false,
        defaultValue: 'studente',
      },
      // Stato di approvazione dell'account.
      //   pending  : in attesa (profilo non completato, oppure docente da approvare)
      //   approved : abilitato all'uso dell'applicazione
      //   rejected : rifiutato dall'amministratore
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      matricola: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      courseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      googleId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      microsoftId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Master switch globale: se false, NESSUNA email transazionale viene inviata
      // (mantenuto per retro-compatibilità: i toggle sotto sono granulari).
      emailNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Preferenze granulari per tipologia di notifica.
      notifyOnConfirmation: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      notifyOnReminder: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      notifyOnCancellation: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Opt-in email su nuovi avvisi della bacheca. Default true: l'utente
      // riceve email solo per gli avvisi che lo riguardano (audience match).
      notifyOnAnnouncements: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Hard-bounce permanente rilevato dal worker SMTP (codici 550/551/553/511/521).
      // Se valorizzato, future enqueueMail per questo utente vengono saltate
      // finché un admin non resetta il flag. Reset automatico quando l'email cambia.
      emailBouncedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      emailBouncedReason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      profilePhotoUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Token a sola lettura usato per la sottoscrizione iCal (webcal://) dai client di calendario.
      // Senza scadenza esplicita; rigenerabile dall'utente per invalidare il link precedente.
      // Al rest persiste SOLO `icalTokenHash` (SHA-256): il plain è mostrato
      // una volta alla generazione e mai più recuperabile — un dump del DB
      // non espone URL funzionanti. La colonna legacy `icalToken` viene
      // azzerata/droppata al boot da preSyncMigrations.
      icalTokenHash: {
        type: DataTypes.STRING(64),
        allowNull: true,
        unique: true,
      },
      lastLogin: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Account lockout per brute force distribuito. Il rate-limit per IP
      // (loginLimiter) ferma il singolo IP, ma un attaccante con botnet può
      // distribuire i tentativi su molti IP contro lo stesso account. Questo
      // contatore + lockedUntil bloccano l'account, non l'IP.
      //
      // Strategia: incrementa su INVALID_CREDENTIALS, reset su login OK.
      // Soglia LOCKOUT_MAX_FAILED (default 10) → lockedUntil = now +
      // LOCKOUT_DURATION_MIN (default 30 min). Dopo la scadenza il contatore
      // resta ma il login ritorna permesso (auto-unlock).
      failedLoginAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Versione dei JWT validi per questo utente. Ogni JWT include il
      // `tokenVersion` corrente nel payload; se l'utente fa logout, cambia
      // password o viene compromesso, incrementiamo questo contatore →
      // tutti i JWT firmati con la versione precedente vengono rifiutati
      // da `authenticate()` al prossimo uso.
      //
      // Pattern alternativo a una blocklist persistente: niente nuove tabelle,
      // niente lookup extra, "logout effettivo" senza dover aspettare la
      // scadenza naturale del token.
      tokenVersion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // 2FA via codice email — opt-in per utente, sempre disattivato di default.
      // Il middleware `require2FAForAdmin` impone l'attivazione agli admin
      // dopo un grace period di 7 gg (vedi services/twoFa.js).
      twoFaEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Sfida 2FA in corso: { hash: bcrypt-hash del codice 6 cifre,
      // expiresAt: ISO date, attempts: int, purpose: 'login'|'enroll'|... }.
      // Single-shot: viene generata fresca ogni volta che il backend manda un
      // codice via email e azzerata sia in caso di verify riuscita che di
      // scadenza. Soppianta il vecchio twoFaSecretEncrypted (TOTP).
      twoFaChallenge: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // [DEPRECATED] Manteniamo la colonna per non rompere DB già migrati con
      // la versione TOTP precedente; non viene più letta né scritta. Verrà
      // rimossa con una migration separata in un ciclo futuro.
      twoFaSecretEncrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Recovery codes hashati (bcrypt cost 4 → veloce, codice già random 80
      // bit → niente brute-force). Array JSON di stringhe; ogni voce è
      // single-use e viene rimossa dopo il consumo.
      twoFaRecoveryCodes: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // Per il grace period admin: data della prima abilitazione 2FA. Resta
      // valorizzata anche dopo eventuali disabilitazioni successive (così se
      // un admin aveva attivato 2FA in passato, riattivarla è immediato).
      twoFaActivatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Bot messaging — challenge OTP per binding canale↔utente.
      // JSON `{ tokenHash, expiresAt }`. Una sola challenge attiva alla volta
      // (sovrascritta a ogni init). Pattern analogo a twoFaChallenge.
      botBindingChallenge: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      // ---- Integrazioni esterne (Isidata, …) ----
      // `externalSource` identifica il sistema sorgente (es. 'isidata'). Se NULL
      // l'utente è nato direttamente in Cadenza (registrazione manuale o admin).
      // `externalId` è l'identificativo nel sistema sorgente (matricola Isidata,
      // staff number, …). Coppia (externalSource, externalId) è UNIQUE quando
      // entrambi sono valorizzati (vedi index sotto).
      externalSource: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      externalId: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      // Note dell'ultima sync (es. "non più presente nel CSV del 2026-04-28 →
      // disabilitato"). Usato dal flusso di "orphan handling" per documentare
      // perché un utente viene disattivato.
      externalStatusNote: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      lastExternalSyncAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // ---- Monte Ore — tipologia contrattuale + override individuale ----
      // Salvato come STRING(40) (no FK) — il valore deve corrispondere al
      // ContractType.code di un record attivo per quell'istituto. La
      // validazione cross-tabella è applicativa (in routes/users.js,
      // routes/auth.js POST /register, e nei flussi di import Isidata).
      // I 4 valori storici (`titolare`, `contratto_orario`, `supplente`,
      // `altro`) sono garantiti dal seed in seeders/initial.js.
      contractType: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      // Override individuale del monte ore annuo. Se valorizzato (>0) sostituisce
      // MonteOreSettings.minRequiredHours per QUESTO docente. Tipico per
      // contratti orari (es. 60h, 120h, 180h) che hanno un monte concordato
      // diverso dal CCNL standard 324h.
      monteOreAnnualHoursOverride: {
        type: DataTypes.FLOAT,
        allowNull: true,
        validate: { min: 0, max: 1500 },
      },
      // Esenzione dal vincolo "2-4 giorni a settimana". Per contratti orari
      // brevi (es. 30h) può aver senso concentrare tutto in un solo giorno.
      monteOreBypassDayConstraint: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Motivazione obbligatoria quando si imposta override o bypass: es.
      // "Contratto orario 60h - prot. 2026/123 del 15/09/2026". Esposta
      // nell'audit log e visibile all'admin nel dettaglio utente.
      monteOreOverrideReason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      monteOreOverrideSetAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      monteOreOverrideSetBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Deroga individuale alla finestra di submission Monte Ore (Fase 6.1):
      // se valorizzata, questo docente può inviare/modificare la sua proposta
      // anche se la finestra globale di MonteOreSettings è chiusa, fino a
      // questa data (inclusa). Tipico per docenti che subentrano in corso
      // d'anno o per recuperi autorizzati dalla Direzione.
      monteOreSubmissionAllowedUntil: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      // Soft delete: User.destroy() valorizza deletedAt invece di rimuovere la
      // riga; le query default escludono automaticamente i record soft-deleted.
      // Per recuperare anche i cancellati: { paranoid: false } o .findAll({ paranoid: false }).
      // Nota: il vincolo UNIQUE su email rimane attivo anche sui record con
      // deletedAt valorizzato. Se servisse "ricreare" un utente con la stessa
      // email occorre prima ripristinarlo (.restore()) o usare un partial
      // unique index su Postgres: CREATE UNIQUE INDEX ... WHERE "deletedAt" IS NULL.
      paranoid: true,
      indexes: [
        { fields: ['email'] },
        { fields: ['role'] },
        { fields: ['matricola'] },
        { fields: ['status'] },
        // UNIQUE composto su (externalSource, externalId) — evita doppioni di
        // import dello stesso record sorgente. Entrambi sono nullable: i valori
        // NULL non collidono (semantica SQL standard, anche su SQLite).
        {
          fields: ['externalSource', 'externalId'],
          unique: true,
          name: 'users_external_source_id_uq',
        },
      ],
    },
  );

  // Hook per hashing password
  User.beforeCreate(async (user) => {
    if (user.passwordHash && !user.passwordHash.startsWith('$2')) {
      user.passwordHash = await bcrypt.hash(user.passwordHash, BCRYPT_COST);
    }
  });

  User.beforeUpdate(async (user) => {
    if (user.changed('passwordHash') && user.passwordHash && !user.passwordHash.startsWith('$2')) {
      user.passwordHash = await bcrypt.hash(user.passwordHash, BCRYPT_COST);
    }
    // Email cambiata → reset del bounce flag: il nuovo indirizzo non eredita
    // il "rimbalzo" del precedente. Senza questo l'admin che corregge un
    // typo dovrebbe anche resettare manualmente.
    if (user.changed('email')) {
      user.emailBouncedAt = null;
      user.emailBouncedReason = null;
    }
  });

  User.prototype.verifyPassword = async function (plain) {
    if (!this.passwordHash) return false;
    return bcrypt.compare(plain, this.passwordHash);
  };

  User.prototype.toSafeJSON = function () {
    const {
      passwordHash,
      twoFaSecretEncrypted,
      twoFaChallenge,
      twoFaRecoveryCodes,
      botBindingChallenge,
      ...safe
    } = this.toJSON();
    return safe;
  };

  return User;
};
