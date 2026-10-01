import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived ticket that lets an editor switch the storefront into draft
 * mode. Format: `<expiry epoch seconds>.<base64url HMAC-SHA256>`.
 *
 * It is signed with the secret the API and the storefront already share for
 * revalidation, under its own purpose label, so a revalidation header can
 * never be replayed as a preview ticket or the other way around. The
 * storefront verifies it with the same recipe (src/lib/preview-token.ts).
 */
const PURPOSE = 'cms-home-preview';

const sign = (secret: string, expiresAtSeconds: number): string =>
  createHmac('sha256', secret)
    .update(`${PURPOSE}:${expiresAtSeconds}`)
    .digest('base64url');

export const signHomePreviewToken = (
  secret: string,
  expiresAt: Date,
): string => {
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  return `${expiresAtSeconds}.${sign(secret, expiresAtSeconds)}`;
};

export const verifyHomePreviewToken = (
  secret: string,
  token: string,
  now: Date = new Date(),
): boolean => {
  const [expiry, signature, ...rest] = token.split('.');
  if (!secret || !expiry || !signature || rest.length) return false;

  const expiresAtSeconds = Number(expiry);
  if (!Number.isInteger(expiresAtSeconds)) return false;
  if (expiresAtSeconds * 1000 < now.getTime()) return false;

  const expected = Buffer.from(sign(secret, expiresAtSeconds));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};
