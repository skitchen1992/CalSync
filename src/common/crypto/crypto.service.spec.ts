import { CryptoService } from './crypto.service.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');
const SECRET = '1//0refresh-token-value';

const createService = (encryptionKey = KEY) => new CryptoService({ encryptionKey });

describe('CryptoService', () => {
  it('round-trips a secret', () => {
    const crypto = createService();

    expect(crypto.decrypt(crypto.encrypt(SECRET))).toBe(SECRET);
  });

  it('produces a versioned payload that does not contain the plaintext', () => {
    const payload = createService().encrypt(SECRET);

    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain(SECRET);
  });

  it('uses a fresh IV for every encryption', () => {
    const crypto = createService();

    expect(crypto.encrypt(SECRET)).not.toBe(crypto.encrypt(SECRET));
  });

  it('rejects a payload encrypted with another key', () => {
    const payload = createService(OTHER_KEY).encrypt(SECRET);

    expect(() => createService().decrypt(payload)).toThrow();
  });

  it('rejects a tampered payload', () => {
    const payload = createService().encrypt(SECRET);
    const [version, iv, tag, ciphertext] = payload.split(':');
    const tampered = [version, iv, tag, `${ciphertext!.slice(0, -2)}AA`].join(':');

    expect(() => createService().decrypt(tampered)).toThrow();
  });
});
