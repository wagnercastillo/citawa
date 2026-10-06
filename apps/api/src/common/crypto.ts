import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY debe ser una clave de 32 bytes en base64');
  return key;
}

/** AES-256-GCM. Devuelve "iv.tag.data" en base64. */
export function encrypt(plain: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(token: string, key: Buffer = encryptionKey()): string {
  const [iv, tag, data] = token.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
