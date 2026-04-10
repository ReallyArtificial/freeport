import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getDb } from '../db/connection.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let encryptionKey: Buffer | null = null;

/** Initialize the encryption key from env var or auto-generated file */
export function initEncryption(): void {
  const envKey = process.env.FREEPORT_ENCRYPTION_KEY;
  if (envKey) {
    // Env var: expect 64-char hex string (32 bytes)
    encryptionKey = Buffer.from(envKey, 'hex');
    if (encryptionKey.length !== 32) {
      throw new Error('FREEPORT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
    }
    return;
  }

  // Auto-generate and store in data/.encryption-key
  const keyPath = resolve(process.cwd(), 'data', '.encryption-key');
  if (existsSync(keyPath)) {
    encryptionKey = Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex');
  } else {
    encryptionKey = randomBytes(32);
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, encryptionKey.toString('hex'), { mode: 0o600 });
  }
}

/** Encrypt plaintext. Returns `iv:authTag:ciphertext` (all base64) */
export function encrypt(plaintext: string): string {
  if (!encryptionKey) throw new Error('Encryption not initialized. Call initEncryption() first.');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Decrypt a string produced by encrypt() */
export function decrypt(encrypted: string): string {
  if (!encryptionKey) throw new Error('Encryption not initialized. Call initEncryption() first.');

  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Check if encryption is initialized */
export function isEncryptionReady(): boolean {
  return encryptionKey !== null;
}

/** Initialize encryption with a specific key (for testing) */
export function initEncryptionWithKey(key: Buffer): void {
  encryptionKey = key;
}

/** Rotate the master encryption key. Re-encrypts all provider keys in the DB. */
export function rotateEncryptionKey(newKeyHex?: string): { rotated: number; failed: number } {
  if (!encryptionKey) throw new Error('Encryption not initialized. Call initEncryption() first.');

  const db = getDb();

  // 1. Read all encrypted providers
  const rows = db.prepare('SELECT id, api_key FROM providers WHERE key_encrypted = 1').all() as Array<{ id: string; api_key: string }>;

  // 2. Decrypt all with current key
  const decryptedKeys: Array<{ id: string; plainKey: string }> = [];
  let failed = 0;
  for (const row of rows) {
    try {
      const plainKey = decrypt(row.api_key);
      decryptedKeys.push({ id: row.id, plainKey });
    } catch {
      failed++;
    }
  }

  // 3. Set new key
  const newKey = newKeyHex ? Buffer.from(newKeyHex, 'hex') : randomBytes(32);
  if (newKey.length !== 32) {
    throw new Error('New key must be a 64-character hex string (32 bytes)');
  }
  encryptionKey = newKey;

  // 4. Re-encrypt all provider keys with new key
  const updateStmt = db.prepare('UPDATE providers SET api_key = ? WHERE id = ?');
  for (const { id, plainKey } of decryptedKeys) {
    const reEncrypted = encrypt(plainKey);
    updateStmt.run(reEncrypted, id);
  }

  // 5. Update key file
  const keyPath = resolve(process.cwd(), 'data', '.encryption-key');
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, encryptionKey.toString('hex'), { mode: 0o600 });

  return { rotated: decryptedKeys.length, failed };
}

/** Reset encryption state (for testing) */
export function resetEncryption(): void {
  encryptionKey = null;
}
