import { describe, expect, it } from 'vitest';
import { isLoopbackIp } from '@/lib/ipAddress';

describe('isLoopbackIp', () => {
  it.each(['::1', '0:0:0:0:0:0:0:1', '127.0.0.1', '127.5.4.3', '::ffff:127.0.0.1'])(
    'riconosce %s come loopback',
    (ip) => {
      expect(isLoopbackIp(ip)).toBe(true);
    },
  );
  it.each(['192.168.1.1', '10.0.0.1', '2001:db8::1', '::ffff:10.0.0.1', '', null, undefined])(
    'non considera %s loopback',
    (ip) => {
      expect(isLoopbackIp(ip)).toBe(false);
    },
  );
});
