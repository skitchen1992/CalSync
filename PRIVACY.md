# CalSync Privacy Policy

Last updated: 23 November 2026

CalSync is a personal, self-hosted tool. It copies events from calendars and schedule tables the
user chooses (Yandex Calendar, Google Sheets) into Google Calendar, and is controlled from a
Telegram bot that answers only the Telegram accounts on its own allowlist. It is not a public
service. Anyone else who wants to use it runs their own copy.

## Google user data

**What CalSync can access.** CalSync requests one Google scope, `calendar.app.created`. With it,
CalSync can create calendars and manage the events in the calendars it created itself. It cannot
see, change or delete any other calendar or event in the Google account.

**What CalSync stores.**

- The Google OAuth refresh token. It is stored only in encrypted form (AES-256-GCM), in CalSync's
  own database on its operator's server.
- For every event it writes: the event's Google id, a hash of its content and its start time, so
  that later syncs update events instead of duplicating them.

CalSync does not store Google profile data, email addresses or the contents of other calendars.

**How it is used.** Only to create and update the calendars CalSync manages for the sources the
user added. Google user data is not sold, not shared with third parties, not used for
advertising and not used to train AI models. CalSync's use and transfer of information received
from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Other data

- **Sources.** The links to the calendars and tables the user adds, stored encrypted.
- **Telegram.** The numeric Telegram user id, to answer only allowed users. Messages are not
  stored.
- **DeepSeek.** When a Google Sheet is added, its header and first 15 rows are sent once to the
  DeepSeek API to recognize the columns. Links in the cells are reduced to their host name first.
  This is the user's own schedule table, not Google user data, and nothing is sent to DeepSeek
  during regular syncs.

## Deleting data

- The bot's `/remove` command deletes a source, the Google calendar CalSync created for it and
  everything CalSync stored about it.
- Access to Google can be revoked at any time at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions). CalSync then stops
  syncing.

## Contact

Questions about this policy: open an issue at
[github.com/skitchen1992/CalSync/issues](https://github.com/skitchen1992/CalSync/issues).
