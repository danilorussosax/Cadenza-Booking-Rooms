'use strict';

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { User } = require('../models');
const { getJwtSecret } = require('../lib/secrets');
const {
  findOrCreateOAuthUser,
  OAuthDomainNotAllowedError,
} = require('../services/users/findOrCreate');

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
          // Distinguiamo tra: (a) utente che ha solo OAuth associato vs
          // (b) utente importato (es. Isidata) che non ha ancora impostato
          // la password. Il frontend usa `code` per mostrare l'azione giusta
          // ("usa Google/Microsoft" vs "controlla la mail di benvenuto").
          const isOAuthOnly = !!(user.googleId || user.microsoftId);
          if (isOAuthOnly) {
            return done(null, false, {
              message: 'Questo account è collegato solo a OAuth. Usa Google/Microsoft.',
              code: 'OAUTH_ONLY',
            });
          }
          return done(null, false, {
            message:
              'Imposta la password tramite il link che hai ricevuto via email. ' +
              "Se non l'hai ricevuto, contatta l'amministrazione.",
            code: 'PASSWORD_NOT_SET',
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
// =============================================
// Verify factories Google/Microsoft: delegano la logica find-or-create
// (con whitelist domini) a services/users/findOrCreate. Eventuali nuovi
// provider OAuth/SAML basta aggiungerli con la stessa factory pattern.
// =============================================
function googleVerify() {
  return async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value || null;
      const user = await findOrCreateOAuthUser({
        provider: 'google',
        providerUserId: profile.id,
        email,
        firstName: profile.name?.givenName,
        lastName: profile.name?.familyName,
      });
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
        profile.emails?.[0]?.value ||
        profile._json?.mail ||
        profile._json?.userPrincipalName ||
        null;
      const user = await findOrCreateOAuthUser({
        provider: 'microsoft',
        providerUserId: profile.id,
        email,
        firstName: profile.name?.givenName || profile._json?.givenName,
        lastName: profile.name?.familyName || profile._json?.surname,
      });
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
