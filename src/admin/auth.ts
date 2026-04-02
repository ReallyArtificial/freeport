import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FreeportConfig } from '../config/types.js';
import { AuthError } from '../utils/errors.js';
import { getLogger } from '../logging/logger.js';

let warnedNoAdminKey = false;

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  // Hash both to ensure equal length (timingSafeEqual requires same-length buffers)
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function createAdminAuth(config: FreeportConfig) {
  return async function adminAuth(request: FastifyRequest, reply: FastifyReply) {
    const adminKey = config.auth?.adminApiKey;

    // If no admin key is set, allow all (development mode) — but warn once
    if (!adminKey) {
      if (!warnedNoAdminKey) {
        const log = getLogger();
        log.warn('No adminApiKey configured — admin API is unprotected. Set auth.adminApiKey in config for production.');
        warnedNoAdminKey = true;
      }
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new AuthError('Missing Authorization header');
    }

    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!safeCompare(token, adminKey)) {
      throw new AuthError('Invalid admin API key');
    }
  };
}
