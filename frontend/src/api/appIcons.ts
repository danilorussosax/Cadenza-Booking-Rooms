import { api } from '@/lib/api';

export interface AppIcon {
  name: string;
  url: string;
  size: number | null;
  mtime: string | null;
}

export const appIconsApi = {
  list: () => api<{ icons: AppIcon[] }>('/api/app-icons'),
};
