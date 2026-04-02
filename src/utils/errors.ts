export class FreeportError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'FreeportError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AuthError extends FreeportError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthError';
  }
}

export class RateLimitError extends FreeportError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export class BudgetExceededError extends FreeportError {
  constructor(message: string = 'Budget exceeded') {
    super(message, 402, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}

export class ProviderError extends FreeportError {
  public readonly provider: string;

  constructor(message: string, provider: string, statusCode: number = 502) {
    super(message, statusCode, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    this.provider = provider;
  }
}

export class GuardrailError extends FreeportError {
  public readonly guardrail: string;
  public readonly details?: unknown;

  constructor(message: string, guardrail: string, details?: unknown) {
    super(message, 400, 'GUARDRAIL_VIOLATION');
    this.name = 'GuardrailError';
    this.guardrail = guardrail;
    this.details = details;
  }
}

export class ValidationError extends FreeportError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends FreeportError {
  constructor(message: string = 'Not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class AllProvidersFailedError extends FreeportError {
  public readonly errors: Array<{ provider: string; error: string }>;

  constructor(errors: Array<{ provider: string; error: string }>) {
    super('All providers in the fallback chain failed', 502, 'ALL_PROVIDERS_FAILED');
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
  }
}
