import {
  signHomePreviewToken,
  verifyHomePreviewToken,
} from './cms-home-preview-token';

const SECRET = 'dev-revalidate-secret';
const NOW = new Date('2026-09-30T12:00:00Z');
const IN_TEN_MINUTES = new Date('2026-09-30T12:10:00Z');

describe('home preview token', () => {
  // Same vector as the storefront's src/lib/preview-token.test.ts: if either
  // side changes the recipe, both suites fail instead of the preview.
  it('signs the contract vector shared with the storefront', () => {
    expect(signHomePreviewToken(SECRET, new Date('2026-09-21T14:13:20Z'))).toBe(
      '1790000000.1pUXbrHlhVQUCIGKUhmKV0QxiyP58FE8WiFcXUor8is',
    );
  });

  it('accepts a token signed with the same secret before it expires', () => {
    const token = signHomePreviewToken(SECRET, IN_TEN_MINUTES);

    expect(verifyHomePreviewToken(SECRET, token, NOW)).toBe(true);
  });

  it('rejects the token once it expired', () => {
    const token = signHomePreviewToken(SECRET, IN_TEN_MINUTES);

    expect(
      verifyHomePreviewToken(SECRET, token, new Date('2026-09-30T12:10:01Z')),
    ).toBe(false);
  });

  it('rejects a token signed with another secret', () => {
    const token = signHomePreviewToken('another-secret', IN_TEN_MINUTES);

    expect(verifyHomePreviewToken(SECRET, token, NOW)).toBe(false);
  });

  it('rejects a token whose expiry was pushed forward by hand', () => {
    const [, signature] = signHomePreviewToken(SECRET, IN_TEN_MINUTES).split(
      '.',
    );
    const forged = `${Date.parse('2027-01-01T00:00:00Z') / 1000}.${signature}`;

    expect(verifyHomePreviewToken(SECRET, forged, NOW)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyHomePreviewToken(SECRET, '', NOW)).toBe(false);
    expect(verifyHomePreviewToken(SECRET, 'abc', NOW)).toBe(false);
    expect(verifyHomePreviewToken(SECRET, 'abc.def', NOW)).toBe(false);
  });
});
