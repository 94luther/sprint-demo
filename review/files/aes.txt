import * as crypto from 'node:crypto';

// AES-256-GCM helper for encrypting personal fields (customer phone, delivery
// address) before they touch data/store.json. The key comes from
// DEMO_MASTER_KEY in .env, 64 hex characters (32 bytes).
//
// Storage format is one string: iv_hex:tag_hex:ciphertext_hex
// Keeping the iv and auth tag alongside the ciphertext is what lets us
// decrypt later; GCM needs both to verify the data was not tampered with.
//
// This is a real, working encryption path for the alpha demo. In production
// the key would live in a secrets manager (not a committed .env) and pin
// hashing is argon2id, swapped 13 Sep 2026, see auth/auth.service.ts.

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.DEMO_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'DEMO_MASTER_KEY must be set in .env as 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(stored: string): string {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed encrypted value, expected iv:tag:ciphertext');
  }
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// Deterministic, one way lookup index so we can find a user by phone number
// without ever decrypting at login time. Not a secret by itself, it only
// ever gets compared against another hash of the same shape.
export function blindIndex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
