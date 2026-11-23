import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { type GoogleAccount, googleAccounts } from '../db/schema.js';

@Injectable()
export class GoogleAccountsRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async findByUser(telegramUserId: number): Promise<GoogleAccount | undefined> {
    const [account] = await this.db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.telegramUserId, telegramUserId));
    return account;
  }

  async upsertConnected(telegramUserId: number, refreshTokenEncrypted: string, scope: string): Promise<void> {
    await this.db
      .insert(googleAccounts)
      .values({ telegramUserId, refreshTokenEncrypted, scope, status: 'connected' })
      .onConflictDoUpdate({
        target: googleAccounts.telegramUserId,
        set: { refreshTokenEncrypted, scope, status: 'connected', updatedAt: new Date() },
      });
  }

  async updateRefreshToken(telegramUserId: number, refreshTokenEncrypted: string): Promise<void> {
    await this.db
      .update(googleAccounts)
      .set({ refreshTokenEncrypted })
      .where(eq(googleAccounts.telegramUserId, telegramUserId));
  }

  /** Marks the account revoked; resolves true only for the call that changed it. */
  async markRevoked(telegramUserId: number): Promise<boolean> {
    const rows = await this.db
      .update(googleAccounts)
      .set({ status: 'revoked' })
      .where(eq(googleAccounts.telegramUserId, telegramUserId))
      .returning({ status: googleAccounts.status });
    return rows.length === 1;
  }
}
