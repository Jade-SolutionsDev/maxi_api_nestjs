export interface DatabaseConfig {
  url: string;
}

export interface ClerkConfig {
  secretKey: string | undefined;
  backofficeSecretKey: string | undefined;
  jwtSecret: string;
  webhookSecret: string | undefined;
  backofficeWebhookSecret: string | undefined;
  invitationRedirectUrl: string | undefined;
}

export interface CorsConfig {
  origins: string[];
  credentials: boolean;
}

export interface AuthConfig {
  mockEnabled: boolean;
  /** Escape hatch for LOCAL/TEST only: accept Clerk webhooks with no signature
   *  when the secret is unset. Never set this in a deployed environment. */
  allowUnverifiedWebhooks: boolean;
}

export interface NotificationsConfig {
  enabled: boolean;
}

export interface StorageConfig {
  driver: string;
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  publicUrl: string;
  forcePathStyle: boolean;
}

export interface StorefrontConfig {
  /** Public base URL of the Next.js storefront (no trailing slash). */
  url: string | undefined;
  /** Shared secret for POST {url}/api/revalidate. Unset disables the pings. */
  revalidateSecret: string | undefined;
}

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  clerk: ClerkConfig;
  cors: CorsConfig;
  auth: AuthConfig;
  notifications: NotificationsConfig;
  storage: StorageConfig;
  storefront: StorefrontConfig;
  nodeEnv: string;
  /** Number of reverse proxies in front of the API (Express `trust proxy`).
   *  Makes req.ip resolve to the real client from X-Forwarded-For, so rate
   *  limiting is per-client instead of per-proxy. Set to the exact hop count
   *  (spoof-safe); 1 = a single Traefik. */
  trustProxyHops: number;
}

/** True only for local/test — never a deployed environment. */
const isLocalEnv = (): boolean => {
  const env = process.env.NODE_ENV ?? 'development';
  return env === 'development' || env === 'test';
};

export const databaseConfig = (): DatabaseConfig => {
  const isTest = process.env.NODE_ENV === 'test';
  const url = isTest
    ? (process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://maxihabana:maxihabana@localhost:5432/maxihabana_test')
    : (process.env.DATABASE_URL ??
      'postgres://maxihabana:maxihabana@localhost:5432/maxihabana');

  return { url };
};

export const clerkConfig = (): ClerkConfig => ({
  secretKey: process.env.CLERK_SECRET_KEY,
  backofficeSecretKey: process.env.CLERK_BACKOFFICE_SECRET_KEY,
  jwtSecret: process.env.CLERK_JWT_SECRET ?? 'dev-secret',
  webhookSecret: process.env.CLERK_WEBHOOK_SECRET,
  backofficeWebhookSecret: process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET,
  invitationRedirectUrl: process.env.CLERK_INVITATION_REDIRECT_URL,
});

export const authConfig = (): AuthConfig => ({
  mockEnabled: process.env.MOCK_AUTH_ENABLED === 'true',
  // The unsigned-webhook escape hatch is honored ONLY in local/test, never in a
  // deployed environment — even if the flag is left set by mistake.
  allowUnverifiedWebhooks:
    isLocalEnv() && process.env.ALLOW_UNVERIFIED_WEBHOOKS === 'true',
});

export const notificationsConfig = (): NotificationsConfig => ({
  // Notifications (Clerk invitation emails) are on by default; disable to
  // silence outbound notifications in local/e2e runs.
  enabled: process.env.NOTIFICATIONS_ENABLED !== 'false',
});

export const storageConfig = (): StorageConfig => {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET ?? 'maxihabana';
  // Default the public base URL to the (path-style) endpoint + bucket so local
  // MinIO works with zero extra config; override with S3_PUBLIC_URL for a CDN.
  const publicUrl =
    process.env.S3_PUBLIC_URL ??
    (endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}` : '');

  return {
    driver: process.env.STORAGE_DRIVER ?? 's3',
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicUrl,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  };
};

export const corsConfig = (): CorsConfig => {
  const raw = process.env.CORS_ORIGINS ?? '';
  const defaultOrigins =
    process.env.NODE_ENV === 'development' ? ['http://localhost:5173'] : [];

  return {
    origins: raw
      ? raw
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : defaultOrigins,
    credentials: process.env.CORS_CREDENTIALS === 'true',
  };
};

export const storefrontConfig = (): StorefrontConfig => ({
  url: process.env.STOREFRONT_URL?.replace(/\/+$/, ''),
  revalidateSecret: process.env.STOREFRONT_REVALIDATE_SECRET,
});

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: databaseConfig(),
  clerk: clerkConfig(),
  cors: corsConfig(),
  auth: authConfig(),
  notifications: notificationsConfig(),
  storage: storageConfig(),
  storefront: storefrontConfig(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
});
