// services/platform-collector/src/errors.js

/**
 * A readable one-line description of whatever was thrown or rejected -- an
 * Error, a string, null, anything -- that never throws itself. For undici's
 * "fetch failed" the message alone says nothing, so the underlying cause
 * (`ECONNREFUSED`, `getaddrinfo ENOTFOUND ...`) is appended in parentheses.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  try {
    const message = String(error?.message ?? error);
    const cause = error?.cause?.code ?? error?.cause?.message;
    return cause === undefined || cause === null || cause === '' ? message : `${message} (${String(cause)})`;
  } catch {
    return 'unprintable error';
  }
}
