import { describe, expect, it } from 'vitest';
import { SECRET_PLACEHOLDER, type ChannelSettingsRow } from '@/api/messaging';
import {
  buildCredentialsPayload,
  displayWebhookUrl,
  fieldError,
  initialCreds,
  initialSettings,
} from '@/lib/messagingForm';

const row: ChannelSettingsRow = {
  channel: 'signal_cli',
  isEnabled: true,
  settings: { phoneNumber: '+39333', port: 993, nested: { a: 1 } },
  credentialsSet: { webhookSecret: true },
};

describe('messagingForm', () => {
  it('fieldError valida il token Telegram', () => {
    expect(fieldError(undefined, 'qualsiasi')).toBeNull();
    expect(fieldError('telegramToken', '')).toBeNull();
    expect(fieldError('telegramToken', SECRET_PLACEHOLDER)).toBeNull();
    expect(fieldError('telegramToken', 'abc')).toBe('invalid_token');
    expect(fieldError('telegramToken', `123456:${'A'.repeat(35)}`)).toBeNull();
  });

  it('initialCreds usa il placeholder per i secret impostati', () => {
    expect(initialCreds([{ key: 'webhookSecret' }, { key: 'other' }], row)).toEqual({
      webhookSecret: SECRET_PLACEHOLDER,
      other: '',
    });
  });

  it('initialSettings tiene solo scalari', () => {
    expect(
      initialSettings([{ key: 'phoneNumber' }, { key: 'port' }, { key: 'nested' }], row),
    ).toEqual({ phoneNumber: '+39333', port: '993', nested: '' });
  });

  it('buildCredentialsPayload', () => {
    expect(buildCredentialsPayload({ a: 'nuovo', b: SECRET_PLACEHOLDER, c: '' })).toEqual({
      a: 'nuovo',
      b: SECRET_PLACEHOLDER,
      c: '',
    });
  });

  it('displayWebhookUrl', () => {
    expect(displayWebhookUrl({ url: '' })).toBe('—');
    expect(displayWebhookUrl({})).toBe('—');
    expect(displayWebhookUrl({ url: 'https://x/y' })).toBe('https://x/y');
  });
});
