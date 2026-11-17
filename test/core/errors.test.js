import { describe, expect, it } from 'vitest';
import { ParseError, isParseError } from '../../src/core/errors.js';

describe('ParseError', () => {
  it('carries a machine-readable code and the byte offset', () => {
    const error = new ParseError('truncated', 'segment runs past the end of the file', 12);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ParseError');
    expect(error.code).toBe('truncated');
    expect(error.offset).toBe(12);
    expect(error.message).toContain('offset 12');
    expect(error.message).toContain('segment runs past the end of the file');
  });

  it('omits the offset from the message when it is unknown', () => {
    const error = new ParseError('unsupported', 'progressive JPEG');
    expect(error.offset).toBe(-1);
    expect(error.message).toBe('progressive JPEG');
  });

  it('is recognised by the type guard', () => {
    expect(isParseError(new ParseError('x', 'y'))).toBe(true);
    expect(isParseError(new Error('plain'))).toBe(false);
    expect(isParseError('string')).toBe(false);
  });
});
