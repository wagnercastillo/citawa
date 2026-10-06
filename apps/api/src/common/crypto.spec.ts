import { randomBytes } from 'crypto';
import { decrypt, encrypt, encryptionKey } from './crypto';

describe('crypto', () => {
  const key = randomBytes(32);

  it('cifra y descifra', () => {
    expect(decrypt(encrypt('mi-api-key', key), key)).toBe('mi-api-key');
  });

  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key));
  });

  it('detecta manipulación y clave incorrecta', () => {
    const [iv, tag, data] = encrypt('secreto', key).split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString('base64')].join('.'), key)).toThrow();
    expect(() => decrypt(encrypt('secreto', key), randomBytes(32))).toThrow();
  });

  it('exige una ENCRYPTION_KEY de 32 bytes', () => {
    const prev = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encryptionKey()).toThrow('ENCRYPTION_KEY');
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    expect(encryptionKey()).toHaveLength(32);
    process.env.ENCRYPTION_KEY = prev;
  });
});
