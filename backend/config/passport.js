'use strict';

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { User } = require('../models');
const { getJwtSecret } = require('../lib/secrets');
const { isEmailAllowed, parseAllowedDomains } = require('../lib/emailDomainPolicy');

/**
 * Errore lanciato dai verify callback OAuth quando il dominio dell'email
 * non rientra nella whitelist amministrativa. La route /callback lo intercetta
 * e redirige a /login con error=oauth_domain_not_allowed.
 */
class OAuthDomainNotAllowedError extends Error {
  constructor(domain) {
    super(`Dominio email non autorizzato: ${domain || 'sconosciuto'}`);
    this.code = 'OAUTH_DOMAIN_NOT_ALLOWED';
    this.domain = domain || null;
  }
}

/**
 * Legge la whitelist di domini email dalle OAuth settings. In caso di errore DB
 * (es. tabella non ancora creata al primo avvio) ritorna `[]` = nessuna restrizione.
 */
async function getAllowedEmailDomains() {
  try {
    const { OAuthSettings } = require('../models');
    const row = await OAuthSettings.findOne({ where: { id: 1 } });
    return parseAllowedDomains(row?.allowedEmailDomains);
  } catch {
    return [];
  }
}

// =============================================
// Strategy: Local (email + password)
// =============================================
passport.use(
  'local',
  new LocalStrategy(
    { usernameField: 'email', passwordField: 'password' },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ where: { email: email.toLowerCase() } });
        if (!user) return done(null, false, { message: 'Credenziali non valide' });
        if (!user.isActive) return done(null, false, { message: 'Account disabilitato' });
        if (!user.passwordHash) {
          return done(null, false, {
            message: 'Questo account è collegato solo a OAuth. Usa Google/Microsoft.',
          });
        }
        const ok = await user.verifyPassword(password);
        if (!ok) return done(null, false, { message: 'Credenziali non valide' });
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// =============================================
// Strategy: JWT (token API)
// =============================================
passport.use(
  'jwt',
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtSecret(),
    },
    async (payload, done) => {
      try {
        const user = await User.findByPk(payload.id);
        if (!user || !user.isActive) return done(null, false);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// =============================================
// Verbs Google/Microsoft handler factory
// =============================================
function googleVerify() {
  return async (accessToken, refreshToken, profile, done) => {
    try {
      const email =
        profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : null;
      if (!email) return done(new Error('Email non disponibile dal profilo Google'));

      // Whitelist domini: applicata PRIMA di qualunque creazione/aggiornamento
      // utente, così l'amministratore può restringere l'accesso senza dover
      // bonificare account già creati. La lista è letta dal DB ad ogni login
      // (no caching) per non richiedere riavvio dopo una modifica.
      const allowed = await getAllowedEmailDomains();
      if (!isEmailAllowed(email, allowed)) {
        const domain = email.split('@').pop();
        return done(new OAuthDomainNotAllowedError(domain));
      }

      let user = await User.findOne({ where: { googleId: profile.id } });
      if (!user) {
        user = await User.findOne({ where: { email } });
        if (user) {
          user.googleId = profile.id;
          await user.save();
        } else {
          user = await User.create({
            email,
            googleId: profile.id,
            firstName: profile.name?.givenName || 'Utente',
            lastName: profile.name?.familyName || 'Google',
            role: 'studente',
            status: 'pending', // dovrà completare il profilo (e scegliere il ruolo)
          });
        }
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  };
}

function microsoftVerify() {
  return async (accessToken, refreshToken, profile, done) => {
    try {
      const email =
        (profile.emails && profile.emails[0]?.value) ||
        profile._json?.mail ||
        profile._json?.userPrincipalName;
      if (!email) return done(new Error('Email non disponibile dal profilo Microsoft'));
      const lowerEmail = email.toLowerCase();

      // Whitelist domini (vedi commento in googleVerify).
      const allowed = await getAllowedEmailDomains();
      if (!isEmailAllowed(lowerEmail, allowed)) {
        const domain = lowerEmail.split('@').pop();
        return done(new OAuthDomainNotAllowedError(domain));
      }

      let user = await User.findOne({ where: { microsoftId: profile.id } });
      if (!user) {
        user = await User.findOne({ where: { email: lowerEmail } });
        if (user) {
          user.microsoftId = profile.id;
          await user.save();
        } else {
          user = await User.create({
            email: lowerEmail,
            microsoftId: profile.id,
            firstName: profile.name?.givenName || profile._json?.givenName || 'Utente',
            lastName: profile.name?.familyName || profile._json?.surname || 'Microsoft',
            role: 'studente',
            status: 'pending', // dovrà completare il profilo (e scegliere il ruolo)
          });
        }
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  };
}

// =============================================
// Carica configurazione OAuth dal DB (con fallback alle env vars)
// e registra le strategie Google/Microsoft. Da invocare allo startup.
// Restituisce { google: bool, microsoft: bool } in base a quali sono attive.
// =============================================
async function initOAuthStrategies() {
  const status = { google: false, microsoft: false };
  let dbSettings = null;
  try {
    const { OAuthSettings } = require('../models');
    dbSettings = await OAuthSettings.findOne({ where: { id: 1 } });
  } catch (err) {
    // Se la tabella non esiste ancora (primo avvio), procedi con sole env vars
    dbSettings = null;
  }

  const { decrypt } = require('../lib/crypto');
  const safeDecrypt = (v) => {
    if (!v) return null;
    try {
      return decrypt(v);
    } catch {
      return null;
    }
  };

  // ---- Google ----
  const gClientId =
    (dbSettings?.googleEnabled && dbSettings?.googleClientId) || process.env.GOOGLE_CLIENT_ID;
  const gSecret =
    (dbSettings?.googleEnabled && safeDecrypt(dbSettings?.googleClientSecretEncrypted)) ||
    process.env.GOOGLE_CLIENT_SECRET;
  const gCallback =
    dbSettings?.googleCallbackUrl || process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback';

  // Regola: se ci sono settings DB, googleEnabled deve essere true. Altrimenti ricado su env vars.
  const googleActive =
    (dbSettings?.googleEnabled && gClientId && gSecret) ||
    (!dbSettings && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (googleActive && gClientId && gSecret) {
    passport.unuse?.('google');
    passport.use(
      new GoogleStrategy(
        { clientID: gClientId, clientSecret: gSecret, callbackURL: gCallback },
        googleVerify(),
      ),
    );
    status.google = true;
  }

  // ---- Microsoft ----
  const mClientId =
    (dbSettings?.microsoftEnabled && dbSettings?.microsoftClientId) ||
    process.env.MICROSOFT_CLIENT_ID;
  const mSecret =
    (dbSettings?.microsoftEnabled && safeDecrypt(dbSettings?.microsoftClientSecretEncrypted)) ||
    process.env.MICROSOFT_CLIENT_SECRET;
  const mCallback =
    dbSettings?.microsoftCallbackUrl ||
    process.env.MICROSOFT_CALLBACK_URL ||
    '/api/auth/microsoft/callback';
  const mTenant = dbSettings?.microsoftTenant || process.env.MICROSOFT_TENANT || 'common';

  const microsoftActive =
    (dbSettings?.microsoftEnabled && mClientId && mSecret) ||
    (!dbSettings && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

  if (microsoftActive && mClientId && mSecret) {
    passport.unuse?.('microsoft');
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: mClientId,
          clientSecret: mSecret,
          callbackURL: mCallback,
          tenant: mTenant,
          scope: ['user.read'],
        },
        microsoftVerify(),
      ),
    );
    status.microsoft = true;
  }

  return status;
}

module.exports = passport;
module.exports.initOAuthStrategies = initOAuthStrategies;
module.exports.OAuthDomainNotAllowedError = OAuthDomainNotAllowedError;
