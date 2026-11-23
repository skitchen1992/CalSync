import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { oauthStates } from '../db/schema.js';

@Injectable()
export class OAuthStatesRepository {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async create(stateHash: string, telegramUserId: number, expiresAt: Date): Promise<void> {
    await this.db.insert(oauthStates).values({ stateHash, telegramUserId, expiresAt });
  }

  /** Deletes the state and returns its user if it existed and had not expired: single use. */
  async consume(stateHash: string, now: Date): Promise<number | undefined> {
    const [row] = await this.db
      .delete(oauthStates)
      .where(and(eq(oauthStates.stateHash, stateHash), gt(oauthStates.expiresAt, now)))
      .returning({ telegramUserId: oauthStates.telegramUserId });
    return row?.telegramUserId;
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  }
}
