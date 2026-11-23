import request from 'supertest';
import { createTestApp, type TestApp } from './support/create-test-app.js';

describe('GET /health', () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await createTestApp();
  });

  afterEach(async () => {
    await testApp.close();
  });

  it('reports the database as up', async () => {
    const { body } = await request(testApp.app.getHttpServer()).get('/health').expect(200);

    expect(body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });

  it('answers 503 without connection details when the database is down', async () => {
    await testApp.pglite.close();

    const { body } = await request(testApp.app.getHttpServer()).get('/health').expect(503);

    expect(body).toMatchObject({
      status: 'error',
      error: { database: { status: 'down', reason: 'unreachable' } },
    });
  });
});
