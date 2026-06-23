import configuration, { databaseConfig, jwtConfig } from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
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
    expect(config.jwt.secret).toBe('dev-secret');
    expect(config.jwt.expiresIn).toBe('1d');
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

  it('should read JWT configuration from environment', () => {
    process.env.JWT_SECRET = 'super-secret';
    process.env.JWT_EXPIRES_IN = '7d';
    expect(jwtConfig().secret).toBe('super-secret');
    expect(jwtConfig().expiresIn).toBe('7d');
  });
});
