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

export interface AppConfig {
  port: number;
  database: DatabaseConfig;
  clerk: ClerkConfig;
  cors: CorsConfig;
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

export const clerkConfig = (): ClerkConfig => ({
  secretKey: process.env.CLERK_SECRET_KEY,
  backofficeSecretKey: process.env.CLERK_BACKOFFICE_SECRET_KEY,
  jwtSecret: process.env.CLERK_JWT_SECRET ?? 'dev-secret',
  webhookSecret: process.env.CLERK_WEBHOOK_SECRET,
  backofficeWebhookSecret: process.env.CLERK_BACKOFFICE_WEBHOOK_SECRET,
  invitationRedirectUrl: process.env.CLERK_INVITATION_REDIRECT_URL,
});

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

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: databaseConfig(),
  clerk: clerkConfig(),
  cors: corsConfig(),
  nodeEnv: process.env.NODE_ENV ?? 'development',
});
