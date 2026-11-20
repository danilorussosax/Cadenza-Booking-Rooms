/** Helper per i confronti di ruolo (specchio di backend/lib/access.js). */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

export function isAdminUser(user: { role?: string | null } | null | undefined): boolean {
  return isAdminRole(user?.role);
}
