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

export interface GatewayCredentials {
  /** Credentials present in this environment. Never enable a gateway without them. */
  configured: boolean;
}

export interface MibiConfig extends GatewayCredentials {
  keyId: string | undefined;
  secretKey: string | undefined;
  webhookSecret: string | undefined;
  baseUrl: string;
  /**
   * Settlement currency for charges. MUST match a receiving account bound to
   * the merchant payment account at Mi Billetera, or charge creation fails
   * with "No active receiving account is bound for currency '<X>'".
   */
  currency: string;
  /**
   * Charge method the store is provisioned for: CRYPTO (deposit-address
   * instructions) or WALLET (the customer pays a Mi Billetera payment request).
   * The store's admin panel example shows which one the account supports.
   */
  method: 'CRYPTO' | 'WALLET';
}

export interface TropipayConfig extends GatewayCredentials {
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** "Development" hits tropipay-dev.herokuapp.com; "Production" the live account. */
  serverMode: 'Development' | 'Production';
  /** Tropipay accepts EUR and USD only — anything else 400s opaquely. */
  currency: string;
}

export interface ExpiryConfig {
  /**
   * Minutes an unpaid gateway order keeps its stock, counted from the newest
   * payment attempt — the customer is at the checkout page right now.
   */
  gatewayMinutes: number;
  /**
   * Hours an unpaid manual order keeps its stock. Longer: it waits on an admin
   * marking it, not on the customer.
   */
  manualHours: number;
  /** Shared secret for the scheduled sweep trigger. */
  cronSecret: string | undefined;
}

export interface PaymentsConfig {
  mibi: MibiConfig;
  tropipay: TropipayConfig;
  /**
   * Public base URL of THIS api, used for gateway callbacks. Must be reachable
   * from the gateway's servers (a tunnel in local development).
   */
  publicUrl: string | undefined;
  expiry: ExpiryConfig;
}

export interface StorefrontConfig {
  /** Public base URL of the Next.js storefront (no trailing slash). */
  url: string | undefined;
  /** Shared secret for POST {url}/api/revalidate. Unset disables the pings. */
  revalidateSecret: string | undefined;
}

export interface ResendConfig {
  apiKey: string | undefined;
  /** Sender address for platform replies, e.g. "Maxi <soporte@maxihabana.com>". */
  fromAddress: string | undefined;
  /** Credentials present. Platform email replies stay disabled without this. */
  configured: boolean;
}

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  clerk: ClerkConfig;
  cors: CorsConfig;
  auth: AuthConfig;
  notifications: NotificationsConfig;
  storage: StorageConfig;
  payments: PaymentsConfig;
  storefront: StorefrontConfig;
  resend: ResendConfig;
  nodeEnv: string;
  /** Number of reverse proxies in front of the API (Express `trust proxy`).
   *  Makes req.ip resolve to the real client from X-Forwarded-For, so rate
   *  limiting is per-client instead of per-proxy. Set to the exact hop count
   *  (spoof-safe); 1 = a single Traefik. */
  trustProxyHops: number;
}

/** True only for local/test — never a deployed environment. */
export const isLocalEnv = (): boolean => {
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
  // Same interlock as the unsigned-webhook hatch below: honored ONLY in
  // local/test. `MockAuthProvider` returns `mock:<clerkId>` as an authenticated
  // user without verifying anything, so a copied `.env` would hand production a
  // superadmin to whoever sends the header. It must not depend on remembering.
  mockEnabled: isLocalEnv() && process.env.MOCK_AUTH_ENABLED === 'true',
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

// A gateway is usable only when its credentials are present. Never in tests:
// e2e checkouts must not create real charges just because .env carries keys.
const isConfigured = (...keys: (string | undefined)[]): boolean =>
  keys.every(Boolean) && process.env.NODE_ENV !== 'test';

// A malformed or non-positive window would either expire everything instantly
// or never expire anything; fall back to the default instead.
const positiveInt = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const paymentsConfig = (): PaymentsConfig => {
  const keyId = process.env.MIBI_KEY_ID;
  const secretKey = process.env.MIBI_SECRET_KEY;
  const clientId = process.env.TROPIPAY_CLIENT_ID;
  const clientSecret = process.env.TROPIPAY_CLIENT_SECRET;

  return {
    mibi: {
      keyId,
      secretKey,
      webhookSecret: process.env.MIBI_WEBHOOK_SECRET,
      baseUrl: (process.env.MIBI_API_BASE ?? 'https://mibilletera.cu').replace(
        /\/$/,
        '',
      ),
      currency: (process.env.MIBI_CURRENCY ?? 'USD').toUpperCase(),
      method:
        (process.env.MIBI_METHOD ?? 'CRYPTO').toUpperCase() === 'WALLET'
          ? 'WALLET'
          : 'CRYPTO',
      configured: isConfigured(keyId, secretKey),
    },
    tropipay: {
      clientId,
      clientSecret,
      serverMode:
        process.env.TROPIPAY_ENV === 'Production'
          ? 'Production'
          : 'Development',
      currency: (process.env.TROPIPAY_CURRENCY ?? 'USD').toUpperCase(),
      configured: isConfigured(clientId, clientSecret),
    },
    publicUrl: process.env.PUBLIC_API_URL?.replace(/\/$/, ''),
    expiry: {
      gatewayMinutes: positiveInt(process.env.ORDER_EXPIRY_GATEWAY_MINUTES, 30),
      manualHours: positiveInt(process.env.ORDER_EXPIRY_MANUAL_HOURS, 24),
      cronSecret: process.env.CRON_SECRET,
    },
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

export const resendConfig = (): ResendConfig => {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM;
  return {
    apiKey,
    fromAddress,
    configured: isConfigured(apiKey, fromAddress),
  };
};

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: databaseConfig(),
  clerk: clerkConfig(),
  cors: corsConfig(),
  auth: authConfig(),
  notifications: notificationsConfig(),
  storage: storageConfig(),
  payments: paymentsConfig(),
  storefront: storefrontConfig(),
  resend: resendConfig(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10),
});
