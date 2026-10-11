import { useQuery } from '@tanstack/react-query';
import { roomsApi } from '@/api/rooms';
import { usersApi } from '@/api/users';
import { bookingTypesApi } from '@/api/bookingTypes';

export function useBookingFormData(open: boolean, isAdmin: boolean) {
  const roomsQuery = useQuery({
    queryKey: ['rooms', 'bookable'],
    queryFn: () => roomsApi.list({ bookable: true }),
    staleTime: 60_000,
    enabled: open,
  });

  // Catalog dinamico tipi prenotazione (gap #7 EasyRoom parity).
  // Restituisce SOLO i tipi attivi, già ordinati per sortOrder. Se la query
  // fallisce o è in caricamento, fallback a `BOOKING_TYPE_OPTIONS` statico.
  const typesQuery = useQuery({
    queryKey: ['booking-types', 'active'],
    queryFn: () => bookingTypesApi.list(),
    staleTime: 5 * 60_000, // catalog cambia raramente
    enabled: open,
  });

  // Lista utenti per il selettore "Prenota a nome di…" (admin only). Carico
  // solo utenti approved+active (gli unici che il backend accetta come owner).
  const usersQuery = useQuery({
    queryKey: ['users', 'approved-active'],
    queryFn: () => usersApi.list({ status: 'approved', active: true }),
    staleTime: 60_000,
    enabled: open && isAdmin,
  });

  return { roomsQuery, typesQuery, usersQuery };
}
