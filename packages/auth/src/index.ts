import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { bearer, twoFactor } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { getMigrations } from 'better-auth/db/migration';
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { createMailer } from './email/mailer';
export const realmSecret = (master: string, realm: string) =>
  createHmac('sha256', master).update(realm).digest('hex');
export function encryption(master: string) {
  const key = Buffer.from(realmSecret(master, 'encryption'), 'hex');
  return {
    seal(value: unknown) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return [iv, cipher.getAuthTag(), bytes].map((b) => b.toString('base64url')).join('.');
    },
    open(value: string) {
      const [iv, tag, bytes] = value.split('.').map((v) => Buffer.from(v, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv!);
      decipher.setAuthTag(tag!);
      return JSON.parse(Buffer.concat([decipher.update(bytes!), decipher.final()]).toString());
    },
  };
}
export async function createRealm(
  db: Database,
  config: {
    secret: string;
    baseURL: string;
    basePath: string;
    origins: string[];
    platform?: boolean;
    providers?: Record<string, { clientId: string; clientSecret: string }>;
    verifyEmail?: boolean;
  },
) {
  const mailer = createMailer();
  const options = {
    logger: { disabled: true },
    database: db,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: config.basePath,
    trustedOrigins: config.origins,
    user: { modelName: '_qb_auth_users' },
    session: { modelName: '_qb_auth_sessions', cookieCache: { enabled: false } },
    account: { modelName: '_qb_auth_accounts' },
    verification: { modelName: '_qb_auth_verifications' },
    advanced: {
      ipAddress: { ipAddressHeaders: ['x-qb-client-ip'] },
      cookiePrefix: `qb_${config.secret.slice(0, 12)}`,
      useSecureCookies: config.baseURL.startsWith('https://'),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      requireEmailVerification: config.verifyEmail ?? false,
      sendResetPassword: async ({ user, url }) => mailer.send(user.email, 'reset-password', url),
    },
    emailVerification: {
      sendOnSignUp: config.verifyEmail ?? false,
      sendVerificationEmail: async ({ user, url }) => mailer.send(user.email, 'verify-email', url),
    },
    socialProviders: config.providers ?? {},
    plugins: [
      bearer(),
      passkey({
        // The ceremony runs on Studio's origin, which can differ from the API.
        rpID: new URL(config.platform ? (config.origins[0] ?? config.baseURL) : config.baseURL)
          .hostname,
        rpName: 'QB Flex',
        origin: config.platform ? config.origins : new URL(config.baseURL).origin,
        // Keep the table in the _qb_auth_* namespace (excluded from schema digests).
        schema: { passkey: { modelName: '_qb_auth_passkeys' } },
      }),
      twoFactor({ issuer: 'QB Flex', twoFactorTable: '_qb_auth_two_factor' }),
    ],
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: 'database',
      modelName: '_qb_auth_rate_limits',
    },
  } satisfies BetterAuthOptions;
  const migrations = await getMigrations(options);
  await migrations.runMigrations();
  return betterAuth(options);
}
