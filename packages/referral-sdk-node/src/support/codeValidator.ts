import type { ReferralConfig } from '../config.js';

/**
 * Referral codes belong to the host application, not this SDK, so validation
 * is delegated to `config.code_validator`. With nothing configured, any
 * non-empty code is accepted — fine for development, but wire up a real
 * validator (e.g. a lookup against your own campaigns table) in production.
 * Mirrors packages/referral-sdk/src/Support/CodeValidator.php.
 */
export async function isValidCode(code: string, config: ReferralConfig): Promise<boolean> {
  const trimmed = code.trim();
  if (trimmed === '') return false;

  if (!config.codeValidator) return true;
  return Boolean(await config.codeValidator(trimmed));
}
