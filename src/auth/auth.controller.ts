import { Controller, Get, Header, Query } from '@nestjs/common';
import { AUTH_MESSAGES } from './auth.messages.js';
import { type GoogleCallbackQuery, googleCallbackQuerySchema } from './auth.schemas.js';
import { GoogleAuthService } from './google-auth.service.js';

const PAGE_BY_OUTCOME = {
  connected: AUTH_MESSAGES.callbackDone,
  denied: AUTH_MESSAGES.callbackDenied,
  incomplete: AUTH_MESSAGES.callbackIncomplete,
} as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly googleAuth: GoogleAuthService) {}

  /** Google's OAuth redirect target (GOOGLE_REDIRECT_URL). The user sees the returned text. */
  @Get('google/callback')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async googleCallback(@Query({ schema: googleCallbackQuerySchema }) query: GoogleCallbackQuery): Promise<string> {
    const outcome = await this.googleAuth.completeAuthorization(query);
    return PAGE_BY_OUTCOME[outcome];
  }
}
