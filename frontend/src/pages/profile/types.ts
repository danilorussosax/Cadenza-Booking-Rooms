import type { useAuth } from '@/contexts/auth';

export type ProfileUser = NonNullable<ReturnType<typeof useAuth>['user']>;
export type UpdateUserFn = ReturnType<typeof useAuth>['updateUser'];
