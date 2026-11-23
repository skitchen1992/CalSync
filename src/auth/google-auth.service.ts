import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { CryptoService } from '../common/crypto/crypto.service.js';
import { Notifier } from '../common/notifier/notifier.js';
import { GoogleOAuthClient } from '../integrations/google/google-oauth.client.js';
import { GoogleAuthorizationIncompleteError } from '../integrations/google/google.errors.js';
import { GoogleNotConnectedError, InvalidOAuthStateError } from './auth.errors.js';
import { AUTH_MESSAGES } from './auth.messages.js';
import { GoogleAccountsRepository } from './google-accounts.repository.js';
import { OAuthStatesRepository } from './oauth-states.repository.js';

const STATE_TTL_MS = 10 * 60 * 1000;

const hashState = (state: string) => createHash('sha256').update(state).digest('base64url');

export interface OAuthCallbackInput {
  state: string;
  code?: string | undefined;
  error?: string | undefined;
}

export type OAuthCallbackOutcome = 'connected' | 'denied' | 'incomplete';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly oauth: GoogleOAuthClient,
    private readonly accounts: GoogleAccountsRepository,
    private readonly states: OAuthStatesRepository,
    private readonly crypto: CryptoService,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  /** A Google consent URL bound to this Telegram user by a random, single-use, short-lived state. */
  async startAuthorization(telegramUserId: number): Promise<string> {
    const now = this.clock.now();
    await this.states.deleteExpired(now);
    const state = randomBytes(32).toString('base64url');
    await this.states.create(hashState(state), telegramUserId, new Date(now.getTime() + STATE_TTL_MS));
    return this.oauth.authorizationUrl(state);
  }

  /** Handles Google's redirect: validates the state, stores the refresh token, tells the user. */
  async completeAuthorization(input: OAuthCallbackInput): Promise<OAuthCallbackOutcome> {
    const telegramUserId = await this.states.consume(hashState(input.state), this.clock.now());
    if (telegramUserId === undefined) {
      this.logger.warn('OAuth callback rejected: state is unknown, expired or already used');
      throw new InvalidOAuthStateError('OAuth state is unknown, expired or already used');
    }

    if (input.error !== undefined || input.code === undefined) {
      this.logger.log('Google authorization declined', { telegramUserId, error: input.error });
      await this.notifier.notify(telegramUserId, AUTH_MESSAGES.deniedInBot);
      return 'denied';
    }

    try {
      const grant = await this.oauth.exchangeCode(input.code);
      await this.accounts.upsertConnected(telegramUserId, this.crypto.encrypt(grant.refreshToken), grant.scope);
    } catch (error) {
      if (error instanceof GoogleAuthorizationIncompleteError) {
        this.logger.warn('Google authorization incomplete', { telegramUserId, reason: error.message });
        await this.notifier.notify(telegramUserId, AUTH_MESSAGES.incompleteInBot);
        return 'incomplete';
      }
      throw error;
    }

    this.logger.log('Google account connected', { telegramUserId });
    await this.notifier.notify(telegramUserId, AUTH_MESSAGES.connectedInBot);
    return 'connected';
  }

  async isConnected(telegramUserId: number): Promise<boolean> {
    const account = await this.accounts.findByUser(telegramUserId);
    return account?.status === 'connected';
  }

  /** The decrypted refresh token, for integration calls on the user's behalf. */
  async getRefreshToken(telegramUserId: number): Promise<string> {
    const account = await this.accounts.findByUser(telegramUserId);
    if (account?.status !== 'connected') {
      throw new GoogleNotConnectedError('Google is not connected');
    }
    return this.crypto.decrypt(account.refreshTokenEncrypted);
  }

  /** Stops using a refresh token Google rejected and tells the user once. */
  async handleRevoked(telegramUserId: number): Promise<void> {
    const account = await this.accounts.findByUser(telegramUserId);
    if (account?.status !== 'connected') {
      return;
    }
    await this.accounts.markRevoked(telegramUserId);
    this.logger.warn('Google access revoked', { telegramUserId });
    await this.notifier.notify(telegramUserId, AUTH_MESSAGES.revokedInBot);
  }
}
