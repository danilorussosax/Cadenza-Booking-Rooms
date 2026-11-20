import { z } from 'zod';

// =====================================================
// Personal info form
// =====================================================
export const personalSchema = z.object({
  firstName: z.string().min(1, 'Inserisci il nome'),
  lastName: z.string().min(1, 'Inserisci il cognome'),
  matricola: z.string().optional(),
  courseId: z.string().optional(),
});
export type PersonalValues = z.infer<typeof personalSchema>;

// =====================================================
// Password form
// =====================================================
export const passwordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, 'La password deve avere almeno 8 caratteri'),
    confirmPassword: z.string().min(1, 'Conferma la nuova password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Le password non coincidono',
  });
export type PasswordValues = z.infer<typeof passwordSchema>;
