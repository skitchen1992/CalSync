# CalSync

Синхронизирует внешние календари с Google Календарём. Управление — через Telegram-бота. Для каждого
источника создаётся отдельный календарь в Google, он обновляется каждые 15 минут.

Поддерживаемые источники:
- встроенные календари Яндекса (`https://calendar.yandex.ru/embed/week?layer_ids=…`);
- расписания в Google Таблицах с доступом «всем, у кого есть ссылка»
  (`https://docs.google.com/spreadsheets/d/…/edit?gid=…`): один лист, одна строка — одно событие.

Следующие на очереди: ICS/CalDAV-фиды.

Стек: NestJS 12 (ESM) · TypeScript 6 · PostgreSQL + Drizzle · Zod · grammY · Vitest · oxlint.
Архитектура и правила разработки: [AGENTS.md](AGENTS.md) → [.agents/rules/](.agents/rules/).

## Как это работает

1. `/connect` в боте → экран согласия Google. Запрашивается scope `calendar.app.created`: CalSync
   может только создавать календари и управлять событиями в календарях, которые создал сам.
2. Пришли ссылку на календарь или таблицу → бот покажет превью → кнопка **✅ Добавить** создаёт
   для этого источника отдельный календарь в Google и сразу синхронизирует его.
   - Для таблицы CalSync один раз просит DeepSeek разметить колонки (дата, время, название, тип,
     ссылка, формат даты, длительность для «15:30 - ?», часовой пояс) по заголовку и первым 15
     строкам; ссылки из ячеек в запрос не попадают. Разметку видно в превью, после подтверждения
     она сохраняется, и дальше строки читаются без LLM.
   - Тип события становится префиксом названия: `[МГУ АКСЕЛЬ] Встреча с трекером`. URL из колонки
     ссылки — место встречи, остальной текст ячейки — описание. Строки с датой, но без времени —
     события на весь день.
   - Если в таблице появится строка, дату или время которой не удалось разобрать, бот один раз
     пришлёт сообщение с номером строки; остальные события синхронизируются как обычно.
3. Раз в минуту диспетчер синхронизирует источники, у которых подошло время. Он скачивает
   события за окно (−7…+60 дней), сравнивает с тем, что уже перенесено, и создаёт, обновляет или
   удаляет события в Google:
   - повторный запуск не создаёт дублей (id событий детерминированные);
   - неудачная или пустая загрузка никогда ничего не удаляет;
   - при ошибках интервал повтора растёт экспоненциально.

Команды бота: `/list`, `/sync`, `/remove`, `/status`, `/help`.

## Настройка

Рекомендуется Node.js 24 LTS (`.nvmrc`). Приложение работает на 22.12+, но npm 10.9.x падает при
установке зависимостей этого проекта, а npm 11 идёт в комплекте с Node 24.

### 1. Telegram-бот
Создай бота у [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`. Свой Telegram id
(например, из [@userinfobot](https://t.me/userinfobot)) впиши в `TELEGRAM_ALLOWED_USER_IDS`.
Остальным пользователям бот не отвечает.

### 2. OAuth-клиент Google
В [Google Cloud Console](https://console.cloud.google.com/):
1. Создай проект и включи **Google Calendar API**.
2. **OAuth consent screen**: тип External, добавь scope `.../auth/calendar.app.created`, а свой
   Google-аккаунт — в **Test users**.
3. **Credentials → Create OAuth client ID → Web application** с authorized redirect URI
   `http://localhost:3100/auth/google/callback` → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Пока экран согласия в режиме **Testing**, Google отзывает refresh-токены через 7 дней. Бот сообщит,
что доступ отозван, и `/connect` восстановит его. После публикации приложения ограничение снимается.

### 3. DeepSeek
Ключ API с [platform.deepseek.com](https://platform.deepseek.com/) → `DEEPSEEK_API_KEY`. Нужен только
при добавлении таблицы; модель задаёт `DEEPSEEK_MODEL` (по умолчанию `deepseek-flash`).

### 4. Запуск
```bash
nvm install && nvm use
npm install
cp .env.example .env        # заполни пустые значения; ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d        # PostgreSQL на localhost:5433
npm run db:migrate
npm run start:dev
```
Открой бота в Telegram и отправь `/start`. `GET http://localhost:3100/health` показывает состояние
базы данных.

## Деплой на сервер

Один сервер с Docker: PostgreSQL, шаг миграций и приложение, без открытых наружу портов
(вход в Google — через SSH-туннель). Пошаговая инструкция: [deploy/README.md](deploy/README.md).
После настройки сервер обновляется сам: каждый push в `main`, прошедший проверки, GitHub
Actions собирает и выкатывает (раздел «Автообновление из GitHub» там же).
Сервер для бота нужен там, где доступен Telegram Bot API: из российских площадок он в 2026
году часто недоступен, поэтому сначала запусти `deploy/check-access.sh`.

## Скрипты

| Команда | Что делает |
| --- | --- |
| `npm run check` | Typecheck, линт, unit- и e2e-тесты. Запускай перед тем, как считать изменение готовым |
| `npm test` / `npm run test:e2e` | Unit-тесты (`src/**/*.spec.ts`) / e2e-тесты (`test/**/*.e2e-spec.ts`, PGlite в процессе, фейки вместо Google и Telegram) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / oxlint (с учётом типов) |
| `npm run db:generate` / `npm run db:migrate` | Сгенерировать миграцию из `src/db/schema.ts` / применить миграции |
| `npm run build` / `npm run start:prod` | Собрать в `dist/` / запустить собранное приложение |
