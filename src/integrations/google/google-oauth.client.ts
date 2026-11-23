import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { googleConfig } from '../../config/google.config.js';
import { GOOGLE_SCOPES } from './google.constants.js';
import { GoogleAuthorizationIncompleteError, translateGoogleError } from './google.errors.js';

export interface GoogleGrant {
  refreshToken: string;
  scope: string;
}

/** OAuth 2.0 web-server flow against Google: consent URL, code exchange, per-account clients. */
@Injectable()
export class GoogleOAuthClient {
  constructor(@Inject(googleConfig.KEY) private readonly config: ConfigType<typeof googleConfig>) {}

  authorizationUrl(state: string): string {
    return this.createClient().generateAuthUrl({
      access_type: 'offline',
      // Always show consent, so Google issues a refresh token even on a reconnect.
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  /** Exchanges the one-time authorization code. Not retried: a code can be used only once. */
  async exchangeCode(code: string): Promise<GoogleGrant> {
    let tokens;
    try {
      ({ tokens } = await this.createClient().getToken(code));
    } catch (error) {
      throw translateGoogleError(error, 'code exchange');
    }

    const granted = new Set((tokens.scope ?? '').split(' '));
    if (!GOOGLE_SCOPES.every((scope) => granted.has(scope))) {
      throw new GoogleAuthorizationIncompleteError('Calendar access was not granted');
    }
    if (!tokens.refresh_token) {
      throw new GoogleAuthorizationIncompleteError('Google did not return a refresh token');
    }
    return { refreshToken: tokens.refresh_token, scope: tokens.scope ?? '' };
  }

  /** A client that authorizes requests for one account; it refreshes access tokens itself. */
  forRefreshToken(refreshToken: string): OAuth2Client {
    const client = this.createClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private createClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUrl,
    });
  }
}
