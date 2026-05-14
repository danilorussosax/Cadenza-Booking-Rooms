import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { ProtectedRoute, PublicOnlyRoute, RequireAdmin } from '@/components/ProtectedRoute';
import { AppLayout } from '@/components/layout/AppLayout';
// Eager: solo Dashboard (home dell'utente loggato) e NotFound (piccolo,
// usato dal catch-all e quindi caricato spesso). Tutto il resto è
// code-split — incluse le pagine di auth (Login/Register/...) che non
// servono al first paint dell'utente già loggato.
import Dashboard from '@/pages/Dashboard';
import NotFound from '@/pages/NotFound';

const Login = lazy(() => import('@/pages/auth/Login'));
const Register = lazy(() => import('@/pages/auth/Register'));
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
const OAuthCallback = lazy(() => import('@/pages/auth/OAuthCallback'));
const OAuthUnavailable = lazy(() => import('@/pages/auth/OAuthUnavailable'));
const CompleteProfile = lazy(() => import('@/pages/auth/CompleteProfile'));
const PendingApproval = lazy(() => import('@/pages/auth/PendingApproval'));
const Rooms = lazy(() => import('@/pages/Rooms'));
const BookingPage = lazy(() => import('@/pages/Booking'));
const MyBookings = lazy(() => import('@/pages/MyBookings'));
const Profile = lazy(() => import('@/pages/Profile'));

const AdminUsers = lazy(() => import('@/pages/admin/Users'));
const AdminCourses = lazy(() => import('@/pages/admin/Courses'));
const AdminStructure = lazy(() => import('@/pages/admin/Structure'));
const AdminDisplayKiosk = lazy(() => import('@/pages/admin/DisplayKiosk'));
const AdminMail = lazy(() => import('@/pages/admin/MailSettings'));
const AdminAuditLog = lazy(() => import('@/pages/admin/AuditLog'));
const AdminActivityLog = lazy(() => import('@/pages/admin/Activity'));
const AdminAnalytics = lazy(() => import('@/pages/admin/Analytics'));
const AdminInstruments = lazy(() => import('@/pages/admin/Instruments'));
const AdminAnnouncements = lazy(() => import('@/pages/admin/Announcements'));
const AdminBookingsManagement = lazy(() => import('@/pages/admin/BookingsManagement'));
const AdminBookings = lazy(() => import('@/pages/admin/Bookings'));
const AdminMessagingSettings = lazy(() => import('@/pages/admin/MessagingSettings'));
const AdminBackups = lazy(() => import('@/pages/admin/Backups'));
const AdminServerSettings = lazy(() => import('@/pages/admin/ServerSettings'));
const AdminIsidataImport = lazy(() => import('@/pages/admin/integrations/IsidataImport'));
const MonteOre = lazy(() => import('@/pages/MonteOre'));
const AdminMonteOre = lazy(() => import('@/pages/admin/MonteOre'));
const AdminMonteOreSettings = lazy(() => import('@/pages/admin/MonteOreSettings'));
const Display = lazy(() => import('@/pages/Display'));
const Instruments = lazy(() => import('@/pages/Instruments'));
const MyLoans = lazy(() => import('@/pages/MyLoans'));
const CheckInRoom = lazy(() => import('@/pages/CheckInRoom'));
const Help = lazy(() => import('@/pages/Help'));
const PrivacyPolicy = lazy(() => import('@/pages/legal/PrivacyPolicy'));
const Terms = lazy(() => import('@/pages/legal/Terms'));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
      <LoaderCircle className="h-6 w-6 animate-spin" />
    </div>
  );
}

const adminPage = (node: ReactNode) => <RequireAdmin>{node}</RequireAdmin>;

export default function App() {
  // Suspense unico a livello app: cattura il caricamento di QUALSIASI pagina
  // lazy. Più pulito di un Suspense per route — il fallback è uniforme e
  // non ci sono mai gap in cui un chunk risolve mentre il routing cambia.
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public-only auth routes */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
        </Route>

        {/* OAuth callback */}
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/oauth-callback.html" element={<OAuthCallback />} />

        {/* OAuth provider non configurato — landing accessibile sia da utente
            anonimo (click su login Google/Microsoft) sia loggato (per qualche
            motivo, es. bookmark): pubblica senza guard. */}
        <Route path="/auth/oauth-unavailable" element={<OAuthUnavailable />} />

        {/* Public display (kiosk) — no auth required */}
        <Route path="/display" element={<Display />} />

        {/* Pagine legali pubbliche (raggiungibili anche da non autenticati) */}
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<Terms />} />

        {/* Profile completion — auth required, no profile required */}
        <Route element={<ProtectedRoute requireProfile={false} requireApproved={false} />}>
          <Route path="/complete-profile" element={<CompleteProfile />} />
        </Route>

        {/* Pending admin approval — auth required, no approved status required */}
        <Route element={<ProtectedRoute requireApproved={false} />}>
          <Route path="/pending-approval" element={<PendingApproval />} />
        </Route>

        {/* All authenticated app routes (user + admin) under one shared layout */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/booking" element={<BookingPage />} />
            <Route path="/my-bookings" element={<MyBookings />} />
            <Route path="/rooms" element={<Rooms />} />
            <Route path="/instruments" element={<Instruments />} />
            <Route path="/my-loans" element={<MyLoans />} />
            <Route path="/check-in/room/:id" element={<CheckInRoom />} />
            <Route path="/monte-ore" element={<MonteOre />} />
            <Route path="/profile" element={<Profile />} />

            {/* Manuali in-app (Help). /help (senza slug) e qualsiasi slug
                non autorizzato per il ruolo corrente sono gestiti da
                Help.tsx, che redirige al manuale "naturale" del ruolo:
                studente → /help/studente, docente → /help/docente,
                admin → /help/docente con switcher interno per accedere
                anche al manuale studente e admin. */}
            <Route path="/help" element={<Help />} />
            <Route path="/help/:slug" element={<Help />} />

            {/* Admin section — RequireAdmin guard inside the same layout */}
            <Route path="/admin">
              <Route index element={<Navigate to="/admin/users" replace />} />
              <Route path="users" element={adminPage(<AdminUsers />)} />
              <Route path="courses" element={adminPage(<AdminCourses />)} />
              <Route path="monte-ore" element={adminPage(<AdminMonteOre />)} />
              <Route path="monte-ore/settings" element={adminPage(<AdminMonteOreSettings />)} />
              <Route path="structure" element={adminPage(<AdminStructure />)} />
              <Route path="instruments" element={adminPage(<AdminInstruments />)} />
              {/* Macro pagina "Gestione prenotazioni" — raggruppa Regole, Tipi
                  e Approvazioni in 3 tab. I vecchi URL restano funzionanti
                  via redirect ai tab corrispondenti per non rompere bookmark. */}
              <Route path="bookings-management" element={adminPage(<AdminBookingsManagement />)} />
              <Route
                path="rules"
                element={<Navigate to="/admin/bookings-management?tab=rules" replace />}
              />
              <Route
                path="booking-types"
                element={<Navigate to="/admin/bookings-management?tab=booking-types" replace />}
              />
              {/* /admin/loan-rules è stato unificato in /admin/instruments → tab "Regole prestito".
                  Manteniamo un redirect per gli URL salvati nei browser/bookmark. */}
              <Route path="loan-rules" element={<Navigate to="/admin/instruments" replace />} />
              <Route path="display" element={adminPage(<AdminDisplayKiosk />)} />
              <Route path="mail" element={adminPage(<AdminMail />)} />
              <Route path="audit-log" element={adminPage(<AdminAuditLog />)} />
              {/* /admin/activity-log — pagina indipendente "Registro attività"
                  (ex sub-tab "Approvazioni" di /admin/audit-log). Voce di
                  sidebar dopo "Approvazione prenotazioni". */}
              <Route path="activity-log" element={adminPage(<AdminActivityLog />)} />
              <Route path="analytics" element={adminPage(<AdminAnalytics />)} />
              <Route path="announcements" element={adminPage(<AdminAnnouncements />)} />
              <Route
                path="approvals"
                element={<Navigate to="/admin/bookings-management?tab=approvals" replace />}
              />
              {/* /admin/bookings (bulk-cancel prenotazioni confermate): ora
                  vive in /admin/activity-log come pagina autonoma. Redirect
                  per chiunque abbia bookmarkato la vecchia rotta. */}
              <Route path="bookings" element={<Navigate to="/admin/activity-log" replace />} />
              {/* La pagina dedicata resta importata e raggiungibile via
                  AdminBookings come componente, ma la rotta principale è
                  redirect. Per uso interno da link diretti: /admin/bookings-page */}
              <Route path="bookings-page" element={adminPage(<AdminBookings />)} />
              <Route path="messaging" element={adminPage(<AdminMessagingSettings />)} />
              <Route path="backups" element={adminPage(<AdminBackups />)} />
              <Route path="server-settings" element={adminPage(<AdminServerSettings />)} />
              <Route path="integrations/isidata" element={adminPage(<AdminIsidataImport />)} />
            </Route>
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
