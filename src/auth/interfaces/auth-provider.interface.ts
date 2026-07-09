/**
 * Result of verifying a bearer token: the Clerk subject id (`sub`) and,
 * optionally, an email claim. Identity + role are resolved from the DB by the
 * consuming service, not from the token.
 */
export interface VerifiedToken {
  sub: string;
  email?: string;
}

/**
 * Swappable authentication backend. Owns only *token -> clerkId* verification.
 * Selected at DI time (real Clerk vs mock) via the {@link AUTH_PROVIDER} token.
 */
export abstract class AuthProvider {
  abstract verifyToken(token: string): Promise<VerifiedToken>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
