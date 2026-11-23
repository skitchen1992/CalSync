import request from 'supertest';
import { GoogleAuthService } from '../src/auth/google-auth.service.js';
import { AUTH_MESSAGES } from '../src/auth/auth.messages.js';
import { CODE_WITHOUT_REFRESH_TOKEN, FAKE_AUTH_HOST } from './fakes/fake-google.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';
import { USER_ID } from './support/scenario.js';

describe('Google OAuth callback', () => {
  let testApp: TestApp;
  let auth: GoogleAuthService;

  beforeEach(async () => {
    testApp = await createTestApp();
    auth = testApp.app.get(GoogleAuthService);
  });

  afterEach(async () => {
    await testApp.close();
  });

  const startState = async () => {
    const url = new URL(await auth.startAuthorization(USER_ID));
    expect(url.origin).toBe(FAKE_AUTH_HOST);
    return url.searchParams.get('state')!;
  };

  const callback = (query: Record<string, string>) =>
    request(testApp.app.getHttpServer()).get('/auth/google/callback').query(query);

  it('connects the account and tells the user in Telegram', async () => {
    const state = await startState();

    const { text } = await callback({ state, code: 'auth-code' }).expect(200);

    expect(text).toBe(AUTH_MESSAGES.callbackDone);
    expect(await auth.isConnected(USER_ID)).toBe(true);
    expect(await auth.getRefreshToken(USER_ID)).toBe('refresh-token-for-auth-code');
    expect(testApp.notifier.textsFor(USER_ID)).toEqual([AUTH_MESSAGES.connectedInBot]);
  });

  it('accepts a state only once', async () => {
    const state = await startState();
    await callback({ state, code: 'auth-code' }).expect(200);

    const { body } = await callback({ state, code: 'auth-code' }).expect(422).expect('Content-Type', /application\/json/);

    expect(body).toMatchObject({ code: 'INVALID_OAUTH_STATE' });
  });

  it('rejects a state it never issued', async () => {
    await callback({ state: 'forged-state', code: 'auth-code' }).expect(422);

    expect(await auth.isConnected(USER_ID)).toBe(false);
  });

  it('handles a declined consent without connecting', async () => {
    const state = await startState();

    const { text } = await callback({ state, error: 'access_denied' }).expect(200);

    expect(text).toBe(AUTH_MESSAGES.callbackDenied);
    expect(await auth.isConnected(USER_ID)).toBe(false);
    expect(testApp.notifier.textsFor(USER_ID)).toEqual([AUTH_MESSAGES.deniedInBot]);
  });

  it('does not connect when Google returns no refresh token', async () => {
    const state = await startState();

    const { text } = await callback({ state, code: CODE_WITHOUT_REFRESH_TOKEN }).expect(200);

    expect(text).toBe(AUTH_MESSAGES.callbackIncomplete);
    expect(await auth.isConnected(USER_ID)).toBe(false);
  });

  it('rejects a callback without a state', async () => {
    await callback({ code: 'auth-code' }).expect(400);
  });
});
