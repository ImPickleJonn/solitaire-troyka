# Solitaire Troyka

Flagship Telegram Mini App for **Tripeaks Solitaire** — the same mechanic that powers Disney Solitaire and Solitaire Grand Harvest. Light on assets, heavy on the mechanics, polish, and progression.

## Status: v0.2.0 (flagship build, 2026-05-20)

`index.html` ≈ 4,065 lines · `server.js` ≈ 524 lines · single self-contained frontend file.

## Highlights

### Core mechanic
- **Tripeaks Solitaire**: tap a card whose rank is exactly ±1 from the waste card. Suit is irrelevant. Ace wraps around (K↔A↔2).
- **Combo multiplier**: every consecutive clear builds the chain — x2 / x3 / x5 / x10 tiers with `NICE! / GREAT! / AMAZING! / INCREDIBLE!` callouts and an audio pitch ramp. Drawing from stock breaks the combo.

### Content depth
- **60 hand-tuned levels** across **5 themed worlds**:
  1. **Royal Garden** (1-12) — onboarding, classic shapes
  2. **Forest of Cards** (13-24) — locks dominate
  3. **Ocean Depths** (25-36) — treasures + waves
  4. **Castle Heights** (37-48) — wild stocks + fortress layouts
  5. **Crystal Caves** (49-60) — memory pieces + the hardest layouts
- **15 distinct tableau layouts** (Tripeak, Twin Peaks, Pyramid, Diamond, Fan, Ring, Crown, Hourglass, Wave, Butterfly, Castle, Heart, Snowflake, Tree, Star) — every level remixes them.
- **5 evolving mechanics** introduced gradually: Locked cards (L4), Multiplier cards (L7), Treasure cards (L10), Wild Stock (L13), Memory Pieces (L25).
- **Boss levels** at each world's end (with crown 👑 on the map node).

### Boosters
- **3 pre-level boosters** (chosen on the level-start screen): Scissors (remove 3 cards), Wild Drop (+3 wilds in stock), Stock Boost (+5 stock cards).
- **5 in-level boosters**: Wild Card, Shuffle, Undo, Peek (see next 3 stock cards), Hammer (destroy any card). Plus `+5 Cards` and `Magic 7s` SKUs in the shop.

### Progression
- **3-star scoring** per level (par / gold / perfect).
- **World chests** at world-end with coin reward + booster pack + themed skin unlock.
- **18 achievements** with claim flow and gem rewards.
- **5 collectible Postcards** — collect memory pieces from levels with `memory` mods to unlock procedurally rendered scenes (Rose Gate, Whisperwood, Coral Reef, Throne Room, Crystal Heart).
- **Daily Challenge** — server-seeded same-for-everyone puzzle.
- **Quest map** with 5 themed world bands, level nodes with star ratings, locked gates between worlds.
- **Stats panel** in Earn tab — games played, best score, best chain, cards played, postcards, perfect levels.

### Retention + lives
- **5-life energy** system, 30-min regen per life, refill option.
- Daily login chest (7-day, `[25, 50, 75, 100, 150, 250, 500]` gem ramp).
- 5 daily missions (`play3`, `chain5`, `share`, `follow`, `streak7`).
- Streak counter with shield support.
- **Battle Pass** (30 days, 2× rewards on missions / chests / achievements).
- Bot notification cron — streak-risk, daily-challenge, comeback nudges (5-min loop, per-kind 24h cooldown, 3/day cap).

### Juice + feel
- **Splash screen** — animated card-fan logo, "Tap to play".
- **Mascot owl** — chubby canvas-drawn owl who follows the chain with its eyes; pops in to encourage on big chains and explain mechanics.
- **Chain trail VFX** — sparkles trail behind every card flying to the waste.
- **Coin rain overlay** on level complete — golden ★ coins shower down.
- **Peak fireworks** — each layer-0 card clear pops a colorful particle burst.
- **3-star reveal** with stagger + audio chime.
- **Canvas-rendered postcards** (5 themed scenes drawn procedurally, no image assets needed).
- **Splash + FTUE** for new players, splash auto-dismiss for returning users.

### Infrastructure
- **Single self-contained `index.html`** + `server.js`. No bundler, no TypeScript, no module splits.
- **Stars-only IAP** (12 public SKUs), idempotent on `telegram_payment_charge_id`.
- **Mixpanel** event proxy (`/api/mp/track`) — `app_open`, `level_start`, `level_complete`, `level_failed`, `iap_attempt`, `iap_paid`, `chest_claim`, `mission_claim`, `achievement_claim`.
- **Server-seeded leaderboard** (50 RU+EN names by default).
- **20-language i18n** scaffold — EN + RU full, 18 others with header strings (EN fallback at `t()` for any missing key). RTL flips for ar/he.

## Structure

```
solitaire-quest-project/      # folder kept under original name; project renamed to Solitaire Troyka in-app
├── index.html       # whole game, ~4,065 lines, 20+ numbered JS sections
├── server.js        # Express + Stars IAP + bot webhook + notif cron + Mixpanel proxy + leaderboard
├── privacy.html
├── terms.html
├── package.json
├── railway.json     # Railway deploy (NIXPACKS)
├── render.yaml      # Render blueprint (persistent /data disk)
├── RUN.bat          # double-click to launch locally
├── versions/        # numbered snapshots before substantive edits
│   ├── solitaire-quest-v1.html  (initial scaffold)
│   ├── solitaire-quest-v2.html  (pre-flagship baseline)
│   ├── solitaire-quest-v3.html  (flagship build)
│   └── solitaire-quest-v4.html  (current)
└── data/            # users.json, leaderboard.json, share images
```

## Quick start (local)

1. Install Node 18+.
2. Double-click `RUN.bat`. It auto-runs `npm install` on first launch.
3. Open `http://localhost:3000`. Telegram WebApp will fall back to dev-mode.

## Telegram setup

See `DEPLOY.md` for the full BotFather → host → webhook flow. Env vars:
- `BOT_TOKEN` (required for IAP + notifications + initData validation)
- `PUBLIC_DOMAIN`
- `MIXPANEL_TOKEN` (optional)
- `DATA_DIR` (`/data` on Render)
- `TELEGRAM_ADMIN_IDS` (defaults to Pickle's UID `23040617`)

## Workflow

- Read the relevant `[JS-NN]` section in `index.html` before editing.
- Snapshot to `versions/solitaire-troyka-vN.html` before substantive edits (numeric sort to find next N). Historical snapshots (`solitaire-quest-v1..v6.html`) are kept as-is — they're frozen pre-rename baselines.
- After every edit, run the inline-script parse-check:
  ```bash
  node -e "const html=require('fs').readFileSync('index.html','utf8'); const m=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; let i=0; for(const s of m){ i++; try { new Function(s[1]); } catch(e) { console.log('FAIL block '+i+': '+e.message); process.exit(1); } } console.log('OK ('+i+' blocks)');"
  ```

## What's locked

- **Single HTML file** for the frontend — no bundlers, no TypeScript, no module splits.
- **Stars-only IAP. NO ads, ever.**
- **3-tab structure Shop / Play / Earn** in that order — matches Match Icon / Fat Stack / Matryoshka so users are pre-trained.
- **Tripeaks core** (±1 with K↔A↔2 wraparound, suit-irrelevant) is the game — other mechanics layer on top of it.
- **3-star scoring + map progression** — don't replace with linear levels or move to single-score endless.

## v0.2.0 changelog (vs v0.1.0)

- **Expanded from 15 → 60 levels** across **5 themed worlds**.
- Added **lives/energy system** (5 lives, 30-min regen, HUD pill with countdown).
- Added **pre-level booster selection screen** with Scissors / Wild Drop / Stock Boost.
- Added 2 new in-level boosters (**Peek**, **Hammer**) wired through `armBooster`.
- Added **18 achievements** with claim flow, popup, and gem rewards.
- Added **5 collectible Postcards** with procedural canvas art.
- Added **world chests** at each world's last level with coins/boosters/skin reward.
- Added **Daily Challenge** entry pill on the map.
- Added **splash screen** with animated card fan.
- Added **mascot owl** that reacts to chains and gives FTUE hints.
- Added **chain trail VFX**, **coin rain on win**, **peak fireworks**.
- Added **stats panel** in Earn tab.
- Redesigned map view with **world bands**, lockable gates between worlds, world chest button.
- Updated state migration to safely top up new fields for v0.1 users.
- Updated i18n EN + RU with ~50 new strings for flagship features.

## Roadmap

- **More worlds** (target 8 worlds × 12 levels = 96 levels by v0.4).
- Real `follow` channel URL (currently placeholder `https://t.me/solitairequestgame`).
- Fully translate remaining 18 languages.
- **Server-seeded weekly tournament** with prize pool (port Matryoshka's pattern).
- **Postcards full-screen reveal modal** with zoom and share-card export.
- **Custom card / mascot illustrations** to replace canvas-drawn art.
- **More card types**: bomb (clear radius), multi-tap (2x/3x), vine (multi-stage cover), self-deck (jumps into stock).
- **Coin betting** system (1×/2×/4×/8× stake per level — Grand Harvest's casino loop).
- **Welcome message asset** (`assets/welcome.{gif,mp4,png,jpg}` path is wired in server.js).
