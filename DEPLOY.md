# Deploying Solitaire Troyka

End-to-end checklist from cold start to live Mini App.

## 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot` → name `Solitaire Troyka`, username e.g. `solitairetroyka_bot`.
2. Save the bot token (looks like `123456:ABC-…`).
3. `/setdomain` → `<your-host-domain>` once deployed.
4. `/newapp` → attach a Mini App to this bot. Pick a name (`Solitaire Troyka`), short name (`play`), description, photo (256×256 PNG square), demo GIF (optional).
5. Set the **Web App URL** to your deployed domain (e.g. `https://solitaire-troyka.up.railway.app`).

## 2. Push to GitHub (optional but recommended)

```bash
cd C:\Users\jonnw\Desktop\solitaire-troyka-project
git init
git add .
git commit -m "v0.1.0 initial scaffold"
gh repo create solitaire-troyka --private --source=. --remote=origin --push
```

## 3. Pick a host

### Option A: Railway (fastest)

1. New Project → "Deploy from GitHub" → select `solitaire-troyka`.
2. Add env vars in Settings → Variables:
   - `BOT_TOKEN` — from BotFather
   - `PUBLIC_DOMAIN` — the railway-generated domain (e.g. `solitaire-troyka-production.up.railway.app`)
   - `MIXPANEL_TOKEN` (optional)
   - `TELEGRAM_ADMIN_IDS` — `23040617`
3. Railway runs `npm ci` then `node server.js` from `railway.json`.
4. Wait for the green ✓.

### Option B: Render (with persistent disk)

1. New → Blueprint → pick `solitaire-troyka` repo → it reads `render.yaml`.
2. Fill in `BOT_TOKEN` and `MIXPANEL_TOKEN` secrets when prompted.
3. Persistent disk mounts to `/data` for `users.json`, `leaderboard.json`, share images.
4. `PUBLIC_DOMAIN` is auto-populated from the service host.

## 4. Register the Telegram webhook

Once deployed, fire this once:

```bash
curl -X POST https://<your-domain>/api/setup-webhook -H "x-setup-key: <BOT_TOKEN>"
```

`/api/setup-webhook` is gated on `x-setup-key == BOT_TOKEN`. It posts to Telegram's `setWebhook` with allowed updates `message, pre_checkout_query`.

## 5. Smoke-test

```bash
curl https://<domain>/api/diag
curl https://<domain>/api/flags
curl https://<domain>/api/skus | head -c 600
curl https://<domain>/api/lb | head -c 300
curl https://<domain>/api/daily-seed
```

Expected:

- `/api/diag` → `botTokenSet:true, dataWritable:true, publicDomain:"<domain>"`
- `/api/flags` → `iapEnabled:true`
- `/api/skus` → 12 SKUs (excluding admin `test_purchase`)
- `/api/lb` → 50 seeded RU+EN names

## 6. Test the Mini App

- Open the bot in Telegram on a phone → `/start` → tap **Play**.
- The Mini App opens; verify FTUE plays on first launch.
- Run Level 1 to test the tripeaks engine.
- Open Shop, tap **Starter Pack** → invoice opens. Pay 199 Stars → reward should arrive within 45s (`/api/poll-purchases` runs on a 45s interval).

## 7. Optional polish

- Drop `assets/welcome.gif` (or `.mp4`/`.png`/`.jpg`) so `/start` greetings can include a hero image. Server picks the first match automatically.
- Set up Mixpanel funnel: `app_open → level_start → level_complete → iap_attempt → iap_paid`.
- Update the `follow` mission URL in `MISSIONS` to your real channel (`index.html`, `[JS-16]`).

## Gotchas

- **Railway uses `npm ci`** which requires `package-lock.json` to match `package.json` exactly. Any new dep means `npm install` locally + commit both files in the same push.
- **Single-file constraint**: keep all frontend code in `index.html`. Section numbering `[JS-NN]` is for fast navigation. No `script src=` to external files.
- **WebView quirks** (inherited from Match Icon):
  - iOS Telegram haptics sometimes don't fire — same code works in other Mini Apps.
  - `env(safe-area-inset-*)` returns 0 in Telegram WebView — we read `Telegram.WebApp.contentSafeAreaInset` instead.
  - `performance.now()` pauses while the WebView is backgrounded — we use `Date.now()` for any real-time clock (streak rollover etc.).
