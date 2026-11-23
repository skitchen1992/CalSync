// User-facing texts of the Google connection flow (Russian, see AGENTS.md).

export const AUTH_MESSAGES = {
  connectedInBot: '✅ Google Календарь подключён. Пришли ссылку на календарь, чтобы добавить источник.',
  deniedInBot: 'Доступ к Google не выдан. Чтобы попробовать снова, отправь /connect.',
  incompleteInBot:
    'Google не выдал нужный доступ. Отправь /connect и на экране согласия разреши доступ к календарям.',
  revokedInBot: '⚠️ Доступ к Google Календарю отозван или истёк. Синхронизация остановлена — отправь /connect.',
  callbackDone: 'Готово! Google Календарь подключён — можно вернуться в Telegram.',
  callbackDenied: 'Доступ не выдан. Вернитесь в Telegram и отправьте /connect, чтобы попробовать снова.',
  callbackIncomplete: 'Google не выдал нужный доступ. Вернитесь в Telegram и отправьте /connect.',
} as const;
