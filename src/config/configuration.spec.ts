import configuration, {
  authConfig,
  clerkConfig,
  corsConfig,
  databaseConfig,
} from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_SECRET;
    delete process.env.CLERK_INVITATION_REDIRECT_URL;
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_CREDENTIALS;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should provide default values', () => {
    process.env.NODE_ENV = 'development';
    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.database.url).toBe(
      'postgres://maxihabana:maxihabana@localhost:5432/maxihabana',
    );
    expect(config.clerk.secretKey).toBeUndefined();
    expect(config.clerk.jwtSecret).toBe('dev-secret');
    expect(config.clerk.invitationRedirectUrl).toBeUndefined();
    expect(config.cors.origins).toEqual(['http://localhost:5173']);
    expect(config.cors.credentials).toBe(false);
    expect(config.nodeEnv).toBe('development');
  });

  it('should read PORT from environment', () => {
    process.env.PORT = '8080';
    expect(configuration().port).toBe(8080);
  });

  it('should default trustProxyHops to 1 and read TRUST_PROXY_HOPS', () => {
    expect(configuration().trustProxyHops).toBe(1);
    process.env.TRUST_PROXY_HOPS = '2';
    expect(configuration().trustProxyHops).toBe(2);
  });

  describe('allowUnverifiedWebhooks', () => {
    it('is honored in local/test when the flag is set', () => {
      process.env.ALLOW_UNVERIFIED_WEBHOOKS = 'true';
      process.env.NODE_ENV = 'development';
      expect(authConfig().allowUnverifiedWebhooks).toBe(true);
      process.env.NODE_ENV = 'test';
      expect(authConfig().allowUnverifiedWebhooks).toBe(true);
    });

    it('is NEVER honored in a deployed environment, even with the flag set', () => {
      process.env.ALLOW_UNVERIFIED_WEBHOOKS = 'true';
      for (const env of ['staging', 'production']) {
        process.env.NODE_ENV = env;
        expect(authConfig().allowUnverifiedWebhooks).toBe(false);
      }
    });
  });

  it('should read DATABASE_URL from environment', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@db:5432/app';
    expect(databaseConfig().url).toBe('postgres://user:pass@db:5432/app');
  });

  it('should prefer TEST_DATABASE_URL when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://user:pass@db:5432/app';
    process.env.TEST_DATABASE_URL = 'postgres://test:test@db:5432/test_db';
    expect(databaseConfig().url).toBe('postgres://test:test@db:5432/test_db');
  });

  it('should fall back to DATABASE_URL when TEST_DATABASE_URL is missing in test', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://user:pass@db:5432/app';
    expect(databaseConfig().url).toBe('postgres://user:pass@db:5432/app');
  });

  it('should read Clerk configuration from environment', () => {
    process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
    process.env.CLERK_BACKOFFICE_SECRET_KEY = 'sk_test_backoffice';
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_store';
    process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET = 'whsec_admin';
    process.env.CLERK_JWT_SECRET = 'super-secret';
    process.env.CLERK_INVITATION_REDIRECT_URL = 'https://example.com/invite';
    expect(clerkConfig().secretKey).toBe('sk_test_clerk');
    expect(clerkConfig().backofficeSecretKey).toBe('sk_test_backoffice');
    expect(clerkConfig().webhookSecret).toBe('whsec_store');
    expect(clerkConfig().backofficeWebhookSecret).toBe('whsec_admin');
    expect(clerkConfig().jwtSecret).toBe('super-secret');
    expect(clerkConfig().invitationRedirectUrl).toBe(
      'https://example.com/invite',
    );
  });

  it('should read CORS origins from environment', () => {
    process.env.CORS_ORIGINS =
      'https://admin.example.com, https://store.example.com';
    process.env.CORS_CREDENTIALS = 'true';
    const config = corsConfig();
    expect(config.origins).toEqual([
      'https://admin.example.com',
      'https://store.example.com',
    ]);
    expect(config.credentials).toBe(true);
  });

  it('should default CORS origins to empty in non-development', () => {
    process.env.NODE_ENV = 'production';
    expect(corsConfig().origins).toEqual([]);
  });
});
