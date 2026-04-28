import { api } from '@/lib/api';

export type MailTemplateKind = 'confirmation' | 'reminder' | 'cancellation';

export interface MailTemplate {
  kind: MailTemplateKind;
  label: string;
  subject: string;
  bodyHtml: string;
  isEnabled: boolean;
  isDefault?: boolean;
  updatedAt?: string;
}

export interface MailTemplatesListResponse {
  templates: MailTemplate[];
  availableVariables: string[];
}

export interface MailTemplatePreview {
  subject: string;
  bodyHtml: string;
  sampleContext: Record<string, Record<string, unknown>>;
}

export const mailTemplatesApi = {
  list: () => api<MailTemplatesListResponse>('/api/admin/mail-templates'),
  get: (kind: MailTemplateKind) =>
    api<{ template: MailTemplate & { defaults: { subject: string; bodyHtml: string } } }>(
      `/api/admin/mail-templates/${kind}`,
    ),
  update: (
    kind: MailTemplateKind,
    payload: { subject?: string; bodyHtml?: string; isEnabled?: boolean },
  ) =>
    api<{ template: MailTemplate }>(`/api/admin/mail-templates/${kind}`, {
      method: 'PUT',
      body: payload,
    }),
  reset: (kind: MailTemplateKind) =>
    api<{ template: MailTemplate }>(`/api/admin/mail-templates/${kind}/reset`, {
      method: 'POST',
    }),
  preview: (kind: MailTemplateKind, draft?: { subject?: string; bodyHtml?: string }) =>
    api<MailTemplatePreview>(`/api/admin/mail-templates/${kind}/preview`, {
      method: 'POST',
      body: draft ?? {},
    }),
};
