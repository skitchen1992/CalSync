import { Notifier } from '../../src/common/notifier/notifier.js';

export class FakeNotifier extends Notifier {
  readonly messages: { telegramUserId: number; text: string }[] = [];

  async notify(telegramUserId: number, text: string): Promise<void> {
    this.messages.push({ telegramUserId, text });
  }

  textsFor(telegramUserId: number): string[] {
    return this.messages.filter((message) => message.telegramUserId === telegramUserId).map((message) => message.text);
  }
}
