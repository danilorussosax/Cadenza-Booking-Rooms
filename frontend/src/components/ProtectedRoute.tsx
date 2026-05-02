import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Role } from '@/types';

interface Props {
  roles?: Role[];
  requireProfile?: boolean;
  requireApproved?: boolean;
}

export function ProtectedRoute({ roles, requireProfile = true, requireApproved = true }: Props) {
  const {
    user,
    loading,
    isAuthenticated,
    isProfileComplete,
    isPendingApproval,
    isApproved,
    hasRole,
  } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <LoaderCircle className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Profilo non ancora completato → completa-profilo
  if (requireProfile && !isProfileComplete) {
    return <Navigate to="/complete-profile" replace />;
  }

  // Profilo completo ma in attesa dell'admin (docente) → pagina di attesa
  if (requireApproved && isPendingApproval) {
    return <Navigate to="/pending-approval" replace />;
  }

  // Account rifiutato dall'admin
  if (requireApproved && !isApproved && !isPendingApproval && user?.role !== 'admin') {
    return <Navigate to="/pending-approval" replace />;
  }

  if (roles?.length && !hasRole(...roles)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet context={{ user }} />;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole('admin')) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function PublicOnlyRoute() {
  const { loading, isAuthenticated, isProfileComplete, isPendingApproval, isApproved, user } =
    useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <LoaderCircle className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (isAuthenticated) {
    let dest = '/dashboard';
    if (!isProfileComplete) dest = '/complete-profile';
    else if (user?.role !== 'admin' && (isPendingApproval || !isApproved))
      dest = '/pending-approval';
    return <Navigate to={dest} replace />;
  }
  return <Outlet />;
}
