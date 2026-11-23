import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import request from 'supertest';
import { z } from 'zod';
import { DomainError } from '../src/common/errors/domain-error.js';
import { createTestApp, type TestApp } from './support/create-test-app.js';

// A probe controller that exists only in this spec, to exercise the global pipe and filters.
class ProbeNotFoundError extends DomainError {
  readonly code = 'PROBE_NOT_FOUND';
  readonly kind = 'not_found';
}

const echoQuerySchema = z.object({ count: z.coerce.number().int().positive() });
type EchoQuery = z.infer<typeof echoQuerySchema>;

const LEAKY_MESSAGE = 'connect failed: postgres://calsync:secret@db.internal:5432/calsync';

@Controller('probe')
class ProbeController {
  @Get('echo')
  echo(@Query({ schema: echoQuerySchema }) query: EchoQuery) {
    return { count: query.count, type: typeof query.count };
  }

  @Get('domain-error')
  domainError(): never {
    throw new ProbeNotFoundError('Probe 42 not found');
  }

  @Get('http-error')
  httpError(): never {
    throw new ForbiddenException('Not yours');
  }

  @Get('crash')
  crash(): never {
    throw new Error(LEAKY_MESSAGE);
  }
}

describe('HTTP pipeline', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('validates and coerces input with the global Standard Schema pipe', async () => {
    const { body } = await request(testApp.app.getHttpServer()).get('/probe/echo?count=3').expect(200);

    expect(body).toEqual({ count: 3, type: 'number' });
  });

  it('rejects input that does not match the schema with 400', async () => {
    await request(testApp.app.getHttpServer()).get('/probe/echo?count=abc').expect(400);
  });

  it('maps a domain error to its HTTP status and code', async () => {
    const { body } = await request(testApp.app.getHttpServer()).get('/probe/domain-error').expect(404);

    expect(body).toEqual({ statusCode: 404, code: 'PROBE_NOT_FOUND', message: 'Probe 42 not found' });
  });

  it('keeps the response shape of Nest HTTP exceptions', async () => {
    const { body } = await request(testApp.app.getHttpServer()).get('/probe/http-error').expect(403);

    expect(body).toEqual({ statusCode: 403, message: 'Not yours', error: 'Forbidden' });
  });

  it('answers unexpected errors with a generic 500 that exposes no internals', async () => {
    const { body, text } = await request(testApp.app.getHttpServer()).get('/probe/crash').expect(500);

    expect(body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(text).not.toContain('secret');
  });
});
