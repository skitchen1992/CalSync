import { loadEnv } from './env.js';

const DATABASE_URL = 'postgres://calsync:calsync@localhost:5433/calsync';

describe('loadEnv', () => {
  it('applies defaults when only required variables are set', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_FORMAT: 'pretty',
      LOG_LEVELS: ['fatal', 'error', 'warn', 'log'],
      DATABASE_URL,
    });
  });

  it('coerces numbers and splits log levels', () => {
    const env = loadEnv({ DATABASE_URL, PORT: '8080', LOG_LEVELS: 'error, debug' });

    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVELS).toEqual(['error', 'debug']);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadEnv({ DATABASE_URL, LOG_LEVELS: 'error,loud' })).toThrow(/LOG_LEVELS/);
  });

  it('names a missing required variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a database URL that is not PostgreSQL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost:3306/calsync' })).toThrow(/DATABASE_URL/);
  });
});
