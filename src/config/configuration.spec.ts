import configuration, { clerkConfig, databaseConfig } from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_SECRET;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should provide default values', () => {
    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.database.url).toBe(
      'postgres://maxihabana:maxihabana@localhost:5432/maxihabana',
    );
    expect(config.clerk.secretKey).toBeUndefined();
    expect(config.clerk.jwtSecret).toBe('dev-secret');
    expect(config.nodeEnv).toBe('development');
  });

  it('should read PORT from environment', () => {
    process.env.PORT = '8080';
    expect(configuration().port).toBe(8080);
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
    process.env.CLERK_JWT_SECRET = 'super-secret';
    expect(clerkConfig().secretKey).toBe('sk_test_clerk');
    expect(clerkConfig().jwtSecret).toBe('super-secret');
  });
});
