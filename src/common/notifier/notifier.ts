/**
 * Sends a message to a user outside of a request/response flow (OAuth callback, background
 * sync). Implemented by the Telegram integration; features depend on this abstraction only.
 * Implementations never throw: a failed notification is logged, not propagated.
 */
export abstract class Notifier {
  abstract notify(telegramUserId: number, text: string): Promise<void>;
}
