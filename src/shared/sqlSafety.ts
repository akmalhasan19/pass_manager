/**
 * SQL Injection Prevention Utilities
 *
 * Provides helper functions to safely construct SQL queries and prevent
 * SQL injection attacks. All database queries should use parameterized
 * statements, but these utilities add defense-in-depth for edge cases.
 */

/**
 * Nanoid default alphabet: A-Za-z0-9_-
 * This regex validates that a string contains only valid nanoid characters
 * and is a reasonable length (1-50 chars).
 */
const VALID_ID_REGEX = /^[A-Za-z0-9_-]{1,50}$/;

/**
 * Validates that a value is a safe string identifier (nanoid format).
 * Rejects empty strings, strings with special characters, and excessively long values.
 *
 * @param id - The ID to validate
 * @returns true if the ID is a valid nanoid-format string, false otherwise
 */
export function isValidId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > 50) {
    return false;
  }
  return VALID_ID_REGEX.test(id);
}

/**
 * Validates an ID and throws if invalid. Use at the boundary of every
 * function that accepts an ID parameter for a database query.
 *
 * @param id - The ID to validate
 * @param context - Optional context for the error message (e.g. 'folder', 'item')
 * @throws {Error} If the ID is not a valid nanoid-format string
 */
export function assertValidId(id: string, context?: string): void {
  if (!isValidId(id)) {
    const label = context ? `${context} ID` : 'ID';
    throw new Error(`Invalid ${label}: must be a non-empty alphanumeric string (1-50 chars).`);
  }
}

/**
 * Escapes special LIKE pattern characters (%, _, [, ]) in a user-supplied
 * search query so they are treated as literal characters in a LIKE clause.
 *
 * In SQL LIKE patterns:
 * - % matches any sequence of characters
 * - _ matches any single character
 * - [...] matches a character class
 *
 * This function escapes these so user input like "100%" becomes "100\%"
 * (with backslash as the escape character).
 *
 * @param query - The raw user search query
 * @returns The escaped string safe for use in a LIKE pattern
 */
export function escapeLikePattern(query: string): string {
  if (typeof query !== 'string') return '';
  return query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[');
}

/**
 * Prepares a user search query for safe use in a LIKE clause.
 * Combines trimming, LIKE pattern escaping, and wrapping in % wildcards.
 *
 * @param query - The raw user search query
 * @returns A LIKE-ready pattern string with % wildcards, or empty string if query is empty
 */
export function prepareLikePattern(query: string): string {
  if (typeof query !== 'string') return '';
  const trimmed = query.trim();
  if (trimmed.length === 0) return '';
  return `%${escapeLikePattern(trimmed)}%`;
}

/**
 * Validates that a numeric value is a safe non-negative integer.
 * Use for sort_order, limit, offset, and similar numeric parameters.
 *
 * @param value - The value to validate
 * @param max - Maximum allowed value (default: Number.MAX_SAFE_INTEGER)
 * @returns true if the value is a safe non-negative integer within range
 */
export function isValidNonNegativeInt(value: unknown, max?: number): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return false;
  }
  if (max !== undefined && value > max) {
    return false;
  }
  return true;
}
