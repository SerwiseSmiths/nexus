import type { ZodError } from 'zod';

// Turns the first Zod validation failure into a plain-language message (e.g.
// "company: Company is required") instead of surfacing a raw issue array as
// the primary error — the full list can still be attached separately (e.g. as
// an ApiError's `data`) for callers that want field-level detail.
export function describeZodError(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Validation failed';
  const field = first.path.join('.');
  return field ? `${field}: ${first.message}` : first.message;
}
