import { describe, it, expect } from 'vitest';
import {
  FreeportError,
  AuthError,
  RateLimitError,
  BudgetExceededError,
  ValidationError,
  NotFoundError,
  AllProvidersFailedError,
} from '../src/utils/errors.js';

describe('Error Classes', () => {
  it('FreeportError has correct defaults', () => {
    const err = new FreeportError('test error');
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err).toBeInstanceOf(Error);
  });

  it('AuthError is 401', () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_ERROR');
  });

  it('RateLimitError is 429', () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('BudgetExceededError is 402', () => {
    const err = new BudgetExceededError();
    expect(err.statusCode).toBe(402);
    expect(err.code).toBe('BUDGET_EXCEEDED');
  });

  it('ValidationError is 400', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('NotFoundError is 404', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('AllProvidersFailedError carries error list', () => {
    const errors = [
      { provider: 'openai', error: 'timeout' },
      { provider: 'anthropic', error: 'rate limited' },
    ];
    const err = new AllProvidersFailedError(errors);
    expect(err.statusCode).toBe(502);
    expect(err.errors).toEqual(errors);
  });
});
