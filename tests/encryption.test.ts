import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  initEncryptionWithKey,
  resetEncryption,
  encrypt,
  decrypt,
  isEncryptionReady,
  rotateEncryptionKey,
} from '../src/crypto/encryption.js';
import { initDb, closeDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { initLogger } from '../src/logging/logger.js';

initLogger('silent');

describe('Encryption Module', () => {
  const testKey = randomBytes(32);

  beforeEach(() => {
    resetEncryption();
  });

  it('encrypt/decrypt round-trip returns original text', () => {
    initEncryptionWithKey(testKey);

    const plaintext = 'Hello, World!';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('encrypting same text twice produces different ciphertext (different IVs)', () => {
    initEncryptionWithKey(testKey);

    const plaintext = 'same text twice';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);

    // Both should still decrypt to the original
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('decrypt with wrong key fails', () => {
    const keyA = randomBytes(32);
    const keyB = randomBytes(32);

    initEncryptionWithKey(keyA);
    const encrypted = encrypt('secret data');

    resetEncryption();
    initEncryptionWithKey(keyB);

    expect(() => decrypt(encrypted)).toThrow();
  });

  it('invalid encrypted format throws', () => {
    initEncryptionWithKey(testKey);

    expect(() => decrypt('not:valid')).toThrow('Invalid encrypted format');
    expect(() => decrypt('onlyonepart')).toThrow('Invalid encrypted format');
    expect(() => decrypt('a:b:c:d')).toThrow('Invalid encrypted format');
  });

  it('encrypt without init throws', () => {
    // resetEncryption() already called in beforeEach, so key is null
    expect(() => encrypt('test')).toThrow('Encryption not initialized');
  });

  it('decrypt without init throws', () => {
    // resetEncryption() already called in beforeEach, so key is null
    expect(() => decrypt('aaa:bbb:ccc')).toThrow('Encryption not initialized');
  });

  it('isEncryptionReady returns false before init', () => {
    // resetEncryption() already called in beforeEach
    expect(isEncryptionReady()).toBe(false);
  });

  it('isEncryptionReady returns true after init', () => {
    initEncryptionWithKey(testKey);

    expect(isEncryptionReady()).toBe(true);
  });

  it('handles special characters (unicode, newlines, emojis)', () => {
    initEncryptionWithKey(testKey);

    const specialText = 'Hello \n\t World! \u00e9\u00e8\u00ea \u00fc\u00f6\u00e4 \u4f60\u597d \ud83d\ude80\ud83c\udf1f "quotes" \'apostrophe\'';
    const encrypted = encrypt(specialText);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(specialText);
  });

  it('handles empty string', () => {
    initEncryptionWithKey(testKey);

    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe('');
  });
});

describe('Encryption Key Rotation', () => {
  const originalKey = randomBytes(32);

  beforeEach(() => {
    resetEncryption();
    const db = initDb(':memory:');
    runMigrations(db);
    initEncryptionWithKey(originalKey);
  });

  afterEach(() => {
    closeDb();
    resetEncryption();
  });

  it('rotates key and re-encrypts all provider keys', () => {
    const db = getDb();
    const apiKey1 = 'sk-secret-key-one';
    const apiKey2 = 'sk-secret-key-two';

    // Insert providers with encrypted keys
    db.prepare(`
      INSERT INTO providers (name, type, api_key, key_encrypted, enabled)
      VALUES (?, ?, ?, 1, 1)
    `).run('provider1', 'openai', encrypt(apiKey1));

    db.prepare(`
      INSERT INTO providers (name, type, api_key, key_encrypted, enabled)
      VALUES (?, ?, ?, 1, 1)
    `).run('provider2', 'anthropic', encrypt(apiKey2));

    // Rotate to a new key
    const newKeyHex = randomBytes(32).toString('hex');
    const result = rotateEncryptionKey(newKeyHex);

    expect(result.rotated).toBe(2);
    expect(result.failed).toBe(0);

    // Verify we can decrypt with the new key
    const rows = db.prepare('SELECT api_key FROM providers ORDER BY name').all() as Array<{ api_key: string }>;
    expect(decrypt(rows[0].api_key)).toBe(apiKey1);
    expect(decrypt(rows[1].api_key)).toBe(apiKey2);
  });

  it('auto-generates key if none provided', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO providers (name, type, api_key, key_encrypted, enabled)
      VALUES (?, ?, ?, 1, 1)
    `).run('provider1', 'openai', encrypt('sk-test-key'));

    const result = rotateEncryptionKey();

    expect(result.rotated).toBe(1);
    expect(result.failed).toBe(0);

    // Verify the key was re-encrypted and is still decryptable
    const row = db.prepare('SELECT api_key FROM providers').get() as { api_key: string };
    expect(decrypt(row.api_key)).toBe('sk-test-key');
  });

  it('throws if encryption not initialized', () => {
    resetEncryption();
    expect(() => rotateEncryptionKey()).toThrow('Encryption not initialized');
  });

  it('handles no encrypted providers gracefully', () => {
    const result = rotateEncryptionKey();
    expect(result.rotated).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('counts failed decryptions', () => {
    const db = getDb();

    // Insert a provider with garbage encrypted data
    db.prepare(`
      INSERT INTO providers (name, type, api_key, key_encrypted, enabled)
      VALUES (?, ?, ?, 1, 1)
    `).run('bad-provider', 'openai', 'not-valid-encrypted-data');

    // Insert a valid one
    db.prepare(`
      INSERT INTO providers (name, type, api_key, key_encrypted, enabled)
      VALUES (?, ?, ?, 1, 1)
    `).run('good-provider', 'openai', encrypt('sk-good-key'));

    const result = rotateEncryptionKey();
    expect(result.rotated).toBe(1);
    expect(result.failed).toBe(1);
  });
});
