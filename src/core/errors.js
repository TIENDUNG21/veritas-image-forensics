/**
 * Error raised for malformed, truncated or unsupported input.
 * Every parser in Veritas throws only this error type for bad bytes, so callers can
 * show the reason and position to the user instead of a stack trace.
 */
export class ParseError extends Error {
  /**
   * @param {string} code Short machine-readable reason, for example `truncated` or `bad-dqt`.
   * @param {string} detail Human-readable explanation.
   * @param {number} [offset] Byte offset where the problem was found, or -1 if unknown.
   */
  constructor(code, detail, offset = -1) {
    super(offset >= 0 ? `${detail} (at offset ${offset})` : detail);
    this.name = 'ParseError';
    this.code = code;
    this.offset = offset;
  }
}

/**
 * @param {unknown} value
 * @returns {value is ParseError}
 */
export function isParseError(value) {
  return value instanceof ParseError;
}
