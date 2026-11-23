import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DomainError, type DomainErrorKind } from '../errors/domain-error.js';

const STATUS_BY_KIND: Record<DomainErrorKind, HttpStatus> = {
  invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  forbidden: HttpStatus.FORBIDDEN,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Maps domain errors that reach the HTTP layer to a status and a stable error code. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  private readonly logger = new Logger(DomainErrorFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(error: DomainError, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const statusCode = STATUS_BY_KIND[error.kind];

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.warn('Domain error answered with a server status', { code: error.code, statusCode });
    }

    httpAdapter.reply(ctx.getResponse(), { statusCode, code: error.code, message: error.message }, statusCode);
  }
}
