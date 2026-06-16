/**
 * Common SQL injection payloads used by Sub-Task 5.3.
 *
 * These strings are intentionally malicious. They must only ever be passed
 * to the database through parameterized queries or bound parameters.
 */

export interface SqlInjectionPayload {
  /** Stable identifier for the test case. */
  id: string;
  /** Human-readable label for the vector. */
  name: string;
  /** Raw, unsanitised SQL injection payload. */
  raw: string;
}

/**
 * A curated set of SQL injection vectors. The first three payloads are the
 * ones explicitly listed in PLANNING-FORM-VALIDATION.md for Sub-Task 5.3.
 */
export const commonSqlInjectionPayloads: readonly SqlInjectionPayload[] = [
  {
    id: 'or-true',
    name: "' OR '1'='1",
    raw: "' OR '1'='1",
  },
  {
    id: 'drop-table-comment',
    name: "'; DROP TABLE items; --",
    raw: "'; DROP TABLE items; --",
  },
  {
    id: 'delete-statement',
    name: '1; DELETE FROM items',
    raw: '1; DELETE FROM items',
  },
  {
    id: 'drop-folders',
    name: "'; DROP TABLE folders; --",
    raw: "'; DROP TABLE folders; --",
  },
  {
    id: 'union-select',
    name: "' UNION SELECT * FROM items --",
    raw: "' UNION SELECT * FROM items --",
  },
  {
    id: 'boolean-or',
    name: "1' OR '1'='1' --",
    raw: "1' OR '1'='1' --",
  },
  {
    id: 'double-quote-or',
    name: '" OR ""="',
    raw: '" OR ""="',
  },
  {
    id: 'sleep',
    name: "'; SELECT sleep(5) --",
    raw: "'; SELECT sleep(5) --",
  },
];
