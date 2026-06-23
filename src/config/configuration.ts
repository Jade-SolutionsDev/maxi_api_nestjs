export interface DatabaseConfig {
  url: string;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  jwt: JwtConfig;
  nodeEnv: string;
}

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

export const jwtConfig = (): JwtConfig => ({
  secret: process.env.JWT_SECRET ?? 'dev-secret',
  expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
});

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: databaseConfig(),
  jwt: jwtConfig(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
});
