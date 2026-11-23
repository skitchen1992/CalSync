import { loadEnv, validateEnv } from './env.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://calsync:calsync@localhost:5433/calsync',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  TELEGRAM_BOT_TOKEN: '123456:test-token',
  TELEGRAM_ALLOWED_USER_IDS: '1001',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URL: 'http://localhost:3000/auth/google/callback',
};

describe('loadEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(loadEnv(REQUIRED)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3100,
      LOG_FORMAT: 'pretty',
      LOG_LEVELS: ['fatal', 'error', 'warn', 'log'],
      TELEGRAM_ALLOWED_USER_IDS: [1001],
      TELEGRAM_POLLING_ENABLED: true,
      SYNC_SCHEDULER_ENABLED: true,
      SYNC_INTERVAL_MINUTES: 15,
      SYNC_WINDOW_PAST_DAYS: 7,
      SYNC_WINDOW_FUTURE_DAYS: 60,
    });
  });

  it('coerces numbers, booleans and lists', () => {
    const env = loadEnv({
      ...REQUIRED,
      PORT: '8080',
      LOG_LEVELS: 'error, debug',
      TELEGRAM_ALLOWED_USER_IDS: '1001, 1002',
      SYNC_SCHEDULER_ENABLED: 'false',
    });

    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVELS).toEqual(['error', 'debug']);
    expect(env.TELEGRAM_ALLOWED_USER_IDS).toEqual([1001, 1002]);
    expect(env.SYNC_SCHEDULER_ENABLED).toBe(false);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadEnv({ ...REQUIRED, LOG_LEVELS: 'error,loud' })).toThrow(/LOG_LEVELS/);
  });

  it('names a missing required variable', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = REQUIRED;

    expect(() => loadEnv(withoutDatabase)).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadEnv({ ...REQUIRED, DATABASE_URL: 'mysql://localhost:3306/calsync' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => loadEnv({ ...REQUIRED, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it('validateEnv keeps raw strings, so lists survive the trip through process.env', () => {
    const raw = { ...REQUIRED, TELEGRAM_ALLOWED_USER_IDS: '1001,1002' };

    expect(validateEnv(raw)).toBe(raw);
    expect(validateEnv(raw)['TELEGRAM_ALLOWED_USER_IDS']).toBe('1001,1002');
  });

  it('validateEnv fails fast on an invalid environment', () => {
    expect(() => validateEnv({ ...REQUIRED, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric Telegram user id', () => {
    expect(() => loadEnv({ ...REQUIRED, TELEGRAM_ALLOWED_USER_IDS: '1001,alice' })).toThrow(
      /TELEGRAM_ALLOWED_USER_IDS/,
    );
  });
});
