import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { toError } from '../errors/to-error.js';

/**
 * Last line of defence for HTTP requests. HttpExceptions keep Nest's response shape; anything
 * else is logged with its stack and answered with a generic 500 that exposes no internals.
 */
@Catch()
export class CatchEverythingFilter implements ExceptionFilter {
  private readonly logger = new Logger(CatchEverythingFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const body = typeof response === 'string' ? { statusCode, message: response } : response;
      httpAdapter.reply(ctx.getResponse(), body, statusCode);
      return;
    }

    const error = toError(exception);
    this.logger.error('Unhandled exception', error.stack, {
      method: httpAdapter.getRequestMethod(ctx.getRequest()),
      path: httpAdapter.getRequestUrl(ctx.getRequest()),
    });

    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    httpAdapter.reply(ctx.getResponse(), { statusCode, message: 'Internal server error' }, statusCode);
  }
}
