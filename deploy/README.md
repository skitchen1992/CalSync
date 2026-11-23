# Деплой CalSync на сервер

Один сервер с Ubuntu и Docker. На нём три контейнера:

- `postgres` — база данных. Наружу не открыта.
- `migrate` — применяет миграции базы и завершается. Приложение стартует только после него.
- `app` — сам CalSync.

Входящих портов из интернета нет. Бот получает сообщения через long polling, а порт
приложения открыт только на `localhost` сервера. Вход в Google (`/connect`) идёт через
SSH-туннель, поэтому домен и HTTPS-сертификат не нужны.

Минимальный сервер: 1 ядро, 1 ГБ памяти, 20 ГБ диска. Например, Sprintbox, тариф BY в Минске.

## 1. Проверь, что с сервера всё доступно

Сразу после создания сервера (Ubuntu 22.04 или 24.04) зайди на него по SSH и выполни:

```bash
apt-get update && apt-get install -y git
git clone https://github.com/skitchen1992/CalSync.git /opt/calsync
bash /opt/calsync/deploy/check-access.sh
```

Скрипт проверяет Telegram, Google, DeepSeek, Яндекс, Docker Hub, npm и GitHub. Если
Telegram недоступен (`FAIL` у `api.telegram.org`), бот на этом сервере работать не будет:
удали сервер и возьми другую площадку.

## 2. Подготовь сервер

```bash
bash /opt/calsync/deploy/setup-server.sh
```

Скрипт добавляет 2 ГБ swap, ставит Docker с плагином compose и включает файрвол
(открыт только SSH).

## 3. Заполни настройки

```bash
cd /opt/calsync/deploy
cp .env.example .env
nano .env
```

- `POSTGRES_PASSWORD` — сгенерируй командой `openssl rand -hex 24`.
- `ENCRYPTION_KEY`:
  - если переносишь локальную базу (шаг 4), то **тот же**, что в локальном `.env`;
  - если начинаешь с чистой базы — новый: `openssl rand -base64 32`.
- `TELEGRAM_*`, `GOOGLE_CLIENT_*`, `DEEPSEEK_API_KEY` — как в локальном `.env`.
- `GOOGLE_REDIRECT_URL` оставь `http://localhost:3100/auth/google/callback`.

Файл `.env` содержит секреты, его не коммитят (он в `.gitignore`). Сохрани копию в
надёжном месте: без `ENCRYPTION_KEY` бэкапы не восстановить.

## 4. Перенеси данные с компьютера (рекомендуется)

Тогда на сервере продолжат работать уже добавленные источники и их календари в Google, и
`/connect` делать не придётся. Если хочешь начать с нуля, пропусти этот шаг.

На компьютере (из папки проекта, локальный Postgres запущен):

```bash
docker compose exec -T postgres pg_dump -U calsync -Fc calsync > calsync.dump
scp calsync.dump root@<IP-сервера>:/opt/calsync/deploy/
```

На сервере:

```bash
cd /opt/calsync/deploy
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U calsync -d calsync --no-owner < calsync.dump
rm calsync.dump
```

## 5. Останови локальный CalSync

Получать сообщения бота может только один процесс. Если оставить локальный
`npm run start:dev`, Telegram будет отдавать обновления то ему, то серверу. А при переносе
базы оба экземпляра синхронизировали бы одни и те же календари. Останови локальный запуск
(Ctrl+C в терминале, где он работает).

## 6. Запусти

```bash
cd /opt/calsync/deploy
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Первая сборка образа на сервере с 1 ГБ памяти занимает несколько минут. В логах должно
появиться `Telegram bot started`. Проверка состояния:
`curl -s localhost:3100/health` → `{"status":"ok",...}`.

## 7. Подключи Google (если начинал с чистой базы)

Google возвращает браузер на `http://localhost:3100/...`, поэтому на время входа пробрось
этот порт с сервера на свой компьютер:

```bash
ssh -N -L 3100:localhost:3100 root@<IP-сервера>
```

Пока команда работает (локальный CalSync при этом должен быть остановлен), отправь боту
`/connect` и открой ссылку в браузере на этом же компьютере. После «Готово!» туннель можно
закрыть (Ctrl+C).

Чтобы доступ не отзывался каждые 7 дней, переведи OAuth-приложение в Google Cloud Console
в режим **In production**: APIs & Services → OAuth consent screen → Publish app. Для личного
использования проверка Google не обязательна. При входе будет предупреждение «Google не
проверил это приложение» → «Дополнительно» → «Перейти».

## Обновление

```bash
cd /opt/calsync
git pull
cd deploy
docker compose up -d --build
```

Новые миграции применятся автоматически: контейнер `migrate` запускается перед приложением.

## Бэкапы

```bash
crontab -e
```

Добавь строку (дамп каждый день в 03:30 по часовому поясу сервера — у Sprintbox это Москва;
дампы хранятся 14 дней):

```
30 3 * * * /opt/calsync/deploy/backup.sh >> /var/log/calsync-backup.log 2>&1
```

Дампы лежат в `/opt/calsync/deploy/backups/`. Время от времени копируй их на свой компьютер:

```bash
scp -r root@<IP-сервера>:/opt/calsync/deploy/backups ./calsync-backups
```

Восстановление — как в шаге 4, только из файла бэкапа.

## Если что-то не так

- Логи: `docker compose logs --tail 200 app` (миграции: `docker compose logs migrate`).
- Перезапуск: `docker compose restart app`.
- Остановка всего (данные сохранятся): `docker compose down`.
- **Docker Hub недоступен:** создай файл `/etc/docker/daemon.json` с содержимым
  `{"registry-mirrors": ["https://mirror.gcr.io"]}` (зеркало Docker Hub от Google),
  затем `systemctl restart docker`.
