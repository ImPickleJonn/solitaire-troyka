// Solitaire Troyka — server.js
// Single-file Express server: Stars IAP, /start bot welcome, bot notifications cron,
// Mixpanel event proxy, leaderboard, daily seed, share-card upload.
// Mirrors the architecture of Match Icon / Fat Stack / Matryoshka.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN || '';

// Purchase notification → shared pickle-notif-bot. No-op unless both env vars
// are set, so this is safe to deploy before the notif bot exists.
const NOTIF_BOT_URL = process.env.NOTIF_BOT_URL || '';
const NOTIF_SECRET  = process.env.NOTIF_SECRET || '';
const NOTIF_GAME_ID = 'solitaire_quest';
function notifyPurchase(info) {
  if (!NOTIF_BOT_URL || !NOTIF_SECRET) return;
  try {
    fetch(NOTIF_BOT_URL.replace(/\/+$/, '') + '/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-notif-key': NOTIF_SECRET },
      body: JSON.stringify({
        game: NOTIF_GAME_ID,
        sku: info.sku,
        stars: info.stars,
        userId: info.userId,
        username: info.username,
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch (_e) {}
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '23040617').split(',').map(s => s.trim()).filter(Boolean);

const VERSION = '0.2.0';

// ---------- persistence ----------
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const LB_PATH = path.join(DATA_DIR, 'leaderboard.json');
const SHARE_DIR = path.join(DATA_DIR, 'share');
try { fs.mkdirSync(SHARE_DIR, { recursive: true }); } catch {}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveJSON(p, obj) {
  try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch (e) { console.error('save fail', p, e.message); }
}

let users = loadJSON(USERS_PATH, {});      // uid -> { lang, streak, coins, level, lastSeen, pendingGrants:[], notifications:{} }
let leaderboard = loadJSON(LB_PATH, null);
if (!leaderboard) leaderboard = seedLeaderboard();

function seedLeaderboard() {
  // RU-heavy seeded names so the board looks alive on day 1.
  const names = [
    'Olga', 'Dmitry', 'Anastasia', 'Mikhail', 'Polina', 'Ivan', 'Ksenia', 'Sergey', 'Yulia', 'Roman',
    'Marina', 'Vladimir', 'Nika', 'Anton', 'Tatyana', 'Pavel', 'Vera', 'Alexey', 'Sofia', 'Nikolai',
    'Daria', 'Boris', 'Lena', 'Maxim', 'Sasha', 'Kirill', 'Vika', 'Andrei', 'Masha', 'Igor',
    'Liam', 'Emma', 'Noah', 'Sophia', 'Mia', 'James', 'Ava', 'Oliver', 'Isabella', 'Lucas',
    'Aiko', 'Yuki', 'Carlos', 'Lucia', 'Hans', 'Greta', 'Ahmed', 'Layla', 'Raj', 'Priya'
  ];
  const lb = [];
  for (let i = 0; i < names.length; i++) {
    lb.push({
      uid: 'seed_' + i,
      name: names[i],
      stars: Math.floor(150 + Math.random() * 500),
      coins: Math.floor(2000 + Math.random() * 9000),
      level: Math.floor(8 + Math.random() * 40),
      isSeed: true
    });
  }
  lb.sort((a, b) => b.stars - a.stars);
  return { players: lb, updatedAt: Date.now() };
}

function persistUsers() { saveJSON(USERS_PATH, users); }
function persistLB() { saveJSON(LB_PATH, leaderboard); }
let usersDirty = false, lbDirty = false;
setInterval(() => {
  if (usersDirty) { persistUsers(); usersDirty = false; }
  if (lbDirty) { persistLB(); lbDirty = false; }
}, 5000);

function getUser(uid) {
  uid = String(uid);
  if (!users[uid]) {
    users[uid] = {
      uid,
      lang: 'en',
      streak: 0,
      coins: 0,
      level: 1,
      stars: 0,
      lastSeen: Date.now(),
      pendingGrants: [],
      notifications: { lastKind: {}, lastAny: 0, todaySent: 0, todayYMD: '' },
      handle: '',
      streakRiskAt: 0
    };
    usersDirty = true;
  }
  return users[uid];
}

// ---------- Telegram initData validation ----------
function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckArr = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`);
    const dataCheckString = dataCheckArr.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calcHash !== hash) return null;
    const userJson = params.get('user');
    if (!userJson) return null;
    return JSON.parse(userJson);
  } catch (e) { return null; }
}

function userFromReq(req) {
  const initData = req.headers['x-telegram-initdata'] || req.body?.initData || '';
  const tgUser = validateInitData(initData);
  if (tgUser) {
    const u = getUser(tgUser.id);
    u.lang = tgUser.language_code || u.lang || 'en';
    u.handle = tgUser.username || tgUser.first_name || u.handle || '';
    u.lastSeen = Date.now();
    usersDirty = true;
    return { uid: String(tgUser.id), tgUser, u, validated: true };
  }
  // Dev fallback: trust uid from header (NOT for production).
  const devUid = req.headers['x-dev-uid'];
  if (devUid && process.env.NODE_ENV !== 'production') {
    const u = getUser(devUid);
    return { uid: String(devUid), tgUser: { id: devUid, first_name: 'dev' }, u, validated: false };
  }
  return null;
}

// ---------- SKUs ----------
const SKUS = {
  coins_small:    { stars: 99,  payload: 'coins_small',    grant: { coins: 1200 } },
  coins_big:      { stars: 399, payload: 'coins_big',      grant: { coins: 5400 } },
  coins_mega:     { stars: 750, payload: 'coins_mega',     grant: { coins: 12000 } },
  starter_pack:   { stars: 199, payload: 'starter_pack',   grant: { coins: 1500, wilds: 3, shuffles: 3, undos: 5, skin: 'royal' }, featured: true },
  revive:         { stars: 30,  payload: 'revive',         grant: { revives: 1 } },
  shuffle_pack:   { stars: 60,  payload: 'shuffle_pack',   grant: { shuffles: 5 } },
  wild_pack:      { stars: 60,  payload: 'wild_pack',      grant: { wilds: 5 } },
  undo_pack:      { stars: 50,  payload: 'undo_pack',      grant: { undos: 7 } },
  streak_shield:  { stars: 99,  payload: 'streak_shield',  grant: { shieldDays: 7 } },
  skin_royal:     { stars: 150, payload: 'skin_royal',     grant: { skin: 'royal' } },
  skin_forest:    { stars: 150, payload: 'skin_forest',    grant: { skin: 'forest' } },
  battle_pass:    { stars: 500, payload: 'battle_pass',    grant: { battlePassDays: 30 } },
  test_purchase:  { stars: 1,   payload: 'test_purchase',  grant: { coins: 10 }, adminOnly: true }
};

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache');
  next();
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));

app.get('/api/diag', (req, res) => {
  let dataWritable = false;
  try { fs.accessSync(DATA_DIR, fs.constants.W_OK); dataWritable = true; } catch {}
  res.json({
    ok: true,
    version: VERSION,
    botTokenSet: !!BOT_TOKEN,
    publicDomain: PUBLIC_DOMAIN || null,
    dataDir: DATA_DIR,
    dataWritable,
    mixpanelSet: !!MIXPANEL_TOKEN,
    users: Object.keys(users).length,
    lbPlayers: leaderboard.players.length
  });
});

app.get('/api/flags', (req, res) => {
  res.json({
    iapEnabled: !!BOT_TOKEN,
    mixpanelEnabled: !!MIXPANEL_TOKEN,
    version: VERSION,
    publicDomain: PUBLIC_DOMAIN || null
  });
});

app.get('/api/skus', (req, res) => {
  const out = {};
  for (const k of Object.keys(SKUS)) {
    if (SKUS[k].adminOnly) continue;
    out[k] = { stars: SKUS[k].stars, payload: SKUS[k].payload, featured: !!SKUS[k].featured };
  }
  res.json({ skus: out });
});

app.get('/api/daily-seed', (req, res) => {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  // deterministic 32-bit seed from ymd
  let h = 2166136261 >>> 0;
  for (let i = 0; i < ymd.length; i++) { h ^= ymd.charCodeAt(i); h = Math.imul(h, 16777619); }
  res.json({ ymd, seed: (h >>> 0) });
});

app.post('/api/heartbeat', (req, res) => {
  const ctx = userFromReq(req);
  if (!ctx) return res.json({ ok: false, reason: 'no-init-data' });
  const { uid, u } = ctx;
  const body = req.body || {};
  if (typeof body.lang === 'string') u.lang = body.lang.slice(0, 8);
  if (typeof body.streak === 'number') u.streak = body.streak | 0;
  if (typeof body.streakRiskAt === 'number') u.streakRiskAt = body.streakRiskAt | 0;
  if (typeof body.level === 'number') u.level = Math.max(u.level || 1, body.level | 0);
  if (typeof body.stars === 'number') u.stars = body.stars | 0;
  if (typeof body.coins === 'number') u.coins = body.coins | 0;
  u.lastSeen = Date.now();
  usersDirty = true;
  res.json({ ok: true, pending: u.pendingGrants.length });
});

app.get('/api/poll-purchases', (req, res) => {
  const ctx = userFromReq(req);
  if (!ctx) return res.json({ grants: [] });
  const { u } = ctx;
  const grants = u.pendingGrants || [];
  u.pendingGrants = [];
  usersDirty = true;
  res.json({ grants });
});

app.post('/api/lb/submit', (req, res) => {
  const ctx = userFromReq(req);
  if (!ctx) return res.json({ ok: false });
  const { uid, u } = ctx;
  u.stars = req.body?.stars | 0 || u.stars;
  u.coins = req.body?.coins | 0 || u.coins;
  u.level = Math.max(u.level || 1, req.body?.level | 0);
  // upsert into leaderboard (drop seeds with same uid)
  leaderboard.players = leaderboard.players.filter(p => p.uid !== uid);
  leaderboard.players.push({ uid, name: u.handle || ('player_' + uid.slice(-4)), stars: u.stars, coins: u.coins, level: u.level, isSeed: false });
  leaderboard.players.sort((a, b) => b.stars - a.stars);
  leaderboard.players = leaderboard.players.slice(0, 200);
  leaderboard.updatedAt = Date.now();
  lbDirty = true; usersDirty = true;
  res.json({ ok: true });
});

app.get('/api/lb', (req, res) => {
  res.json({ players: leaderboard.players.slice(0, 100), updatedAt: leaderboard.updatedAt });
});

// ---------- Mixpanel event proxy ----------
app.post('/api/mp/track', async (req, res) => {
  if (!MIXPANEL_TOKEN) return res.json({ ok: false, reason: 'no-token' });
  const ctx = userFromReq(req);
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (!events.length) return res.json({ ok: true, sent: 0 });
  const data = events.slice(0, 50).map(ev => ({
    event: String(ev.event || 'unknown').slice(0, 64),
    properties: Object.assign({
      token: MIXPANEL_TOKEN,
      time: Math.floor(Date.now() / 1000),
      distinct_id: ctx ? ctx.uid : ('anon_' + (req.ip || '0')),
      $insert_id: crypto.randomBytes(8).toString('hex'),
      app: 'solitaire-troyka',
      version: VERSION
    }, ev.properties || {})
  }));
  try {
    const body = Buffer.from(JSON.stringify(data)).toString('base64');
    const resp = await fetch('https://api.mixpanel.com/track?ip=1', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(body)
    });
    res.json({ ok: resp.ok, sent: data.length });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- Stars IAP ----------
app.post('/api/iap/create-invoice', async (req, res) => {
  if (!BOT_TOKEN) return res.json({ ok: false, reason: 'no-bot-token' });
  const ctx = userFromReq(req);
  if (!ctx) return res.json({ ok: false, reason: 'no-init-data' });
  const sku = String(req.body?.sku || '');
  const def = SKUS[sku];
  if (!def) return res.json({ ok: false, reason: 'unknown-sku' });
  if (def.adminOnly && !ADMIN_IDS.includes(ctx.uid)) return res.json({ ok: false, reason: 'admin-only' });
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`;
    const payload = `${def.payload}:${ctx.uid}:${Date.now()}`;
    const body = {
      title: skuTitle(sku),
      description: skuDescription(sku),
      payload,
      currency: 'XTR',
      prices: [{ label: skuTitle(sku), amount: def.stars }]
    };
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.ok && j.result) return res.json({ ok: true, link: j.result });
    return res.json({ ok: false, reason: 'telegram-error', detail: j });
  } catch (e) {
    return res.json({ ok: false, error: e.message });
  }
});

function skuTitle(sku) {
  return {
    coins_small: 'Small Coin Bag', coins_big: 'Big Coin Sack', coins_mega: 'Mega Coin Chest',
    starter_pack: 'Starter Pack', revive: 'Revive', shuffle_pack: 'Shuffle Pack',
    wild_pack: 'Wild Cards', undo_pack: 'Undo Pack', streak_shield: 'Streak Shield (7d)',
    skin_royal: 'Royal Skin', skin_forest: 'Forest Skin', battle_pass: 'Battle Pass (30d)',
    test_purchase: 'Test Purchase'
  }[sku] || sku;
}
function skuDescription(sku) {
  return {
    coins_small: '1,200 coins to fuel your runs.',
    coins_big: '5,400 coins. Best for the long quest.',
    coins_mega: '12,000 coins. Big spender pack.',
    starter_pack: 'One-time: 1,500 coins + 3 wilds + 3 shuffles + 5 undos + Royal skin.',
    revive: 'Get one extra life on game over.',
    shuffle_pack: '5 in-level shuffles.',
    wild_pack: '5 wild cards to break tough chains.',
    undo_pack: '7 undos to fix mistakes.',
    streak_shield: 'Protect your daily streak for 7 days.',
    skin_royal: 'Unlock the Royal table skin.',
    skin_forest: 'Unlock the Forest table skin.',
    battle_pass: '30 days of doubled rewards.',
    test_purchase: 'Admin testing purchase. Grants 10 coins.'
  }[sku] || 'Solitaire Troyka item.';
}

// Telegram bot webhook — handles /start, pre_checkout_query, successful_payment.
app.post('/api/tg-webhook', async (req, res) => {
  res.json({ ok: true });
  const update = req.body || {};
  try {
    if (update.message?.text) {
      const text = update.message.text || '';
      const chatId = update.message.chat.id;
      const lang = update.message.from?.language_code || 'en';
      if (text.startsWith('/start')) {
        await handleStart(chatId, lang);
      }
    }
    if (update.pre_checkout_query) {
      const pcq = update.pre_checkout_query;
      await tgCall('answerPreCheckoutQuery', { pre_checkout_query_id: pcq.id, ok: true });
    }
    if (update.message?.successful_payment) {
      const sp = update.message.successful_payment;
      const fromId = String(update.message.from.id);
      const payload = sp.invoice_payload || '';
      const [skuKey] = payload.split(':');
      const sku = SKUS[skuKey];
      if (sku) {
        const u = getUser(fromId);
        // idempotency: dedupe on telegram_payment_charge_id
        u.pendingGrants = u.pendingGrants || [];
        const already = u.pendingGrants.find(g => g.chargeId === sp.telegram_payment_charge_id);
        if (!already) {
          u.pendingGrants.push({
            chargeId: sp.telegram_payment_charge_id,
            sku: skuKey,
            grant: sku.grant,
            stars: sp.total_amount,
            ts: Date.now()
          });
          usersDirty = true;
        }
        await tgCall('sendMessage', {
          chat_id: fromId,
          text: `Thanks! Your ${skuTitle(skuKey)} will arrive in-game on next refresh.`
        });
        notifyPurchase({
          sku: skuKey,
          stars: sp.total_amount || sku.price || 0,
          userId: fromId,
          username: update.message.from && update.message.from.username,
        });
      }
    }
  } catch (e) {
    console.error('webhook error', e.message);
  }
});

async function tgCall(method, payload) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) {
    console.error('tg', method, e.message);
    return null;
  }
}

async function handleStart(chatId, lang) {
  const greet = (lang || '').startsWith('ru')
    ? `👑 Добро пожаловать в Solitaire Troyka!\n\nТри пика. Бесконечные комбо. Уютная карта приключений.\n\nНажмите ниже, чтобы начать.`
    : `👑 Welcome to Solitaire Troyka!\n\nThree peaks. Endless combos. A cozy adventure map.\n\nTap below to start playing.`;
  const playUrl = PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}` : '';
  const reply_markup = playUrl ? { inline_keyboard: [[{ text: '▶️ Play', web_app: { url: playUrl } }]] } : undefined;
  // Try welcome.{gif,mp4,png,jpg}
  const candidates = ['welcome.gif', 'welcome.mp4', 'welcome.png', 'welcome.jpg'];
  let asset = null;
  for (const c of candidates) {
    const full = path.join(__dirname, 'assets', c);
    if (fs.existsSync(full)) { asset = { kind: c.endsWith('.gif') || c.endsWith('.mp4') ? 'animation' : 'photo', file: full }; break; }
  }
  if (asset) {
    // Use sendAnimation for gif/mp4, sendPhoto for png/jpg via multipart
    // For simplicity, send text only — assets path is a future enhancement.
  }
  await tgCall('sendMessage', { chat_id: chatId, text: greet, reply_markup });
}

app.post('/api/setup-webhook', async (req, res) => {
  const key = req.headers['x-setup-key'] || '';
  if (!BOT_TOKEN) return res.status(400).json({ ok: false, reason: 'no-bot-token' });
  if (key !== BOT_TOKEN) return res.status(403).json({ ok: false, reason: 'bad-setup-key' });
  if (!PUBLIC_DOMAIN) return res.status(400).json({ ok: false, reason: 'no-public-domain' });
  const url = `https://${PUBLIC_DOMAIN}/api/tg-webhook`;
  const r = await tgCall('setWebhook', { url, allowed_updates: ['message', 'pre_checkout_query'] });
  res.json({ ok: !!r?.ok, telegram: r });
});

// ---------- bot notifications cron ----------
function ymd(d = new Date()) { return d.toISOString().slice(0, 10); }

async function runNotifCron() {
  if (!BOT_TOKEN) return;
  const now = Date.now();
  const today = ymd();
  for (const uid of Object.keys(users)) {
    const u = users[uid];
    if (!u.notifications) u.notifications = { lastKind: {}, lastAny: 0, todaySent: 0, todayYMD: '' };
    if (u.notifications.todayYMD !== today) {
      u.notifications.todayYMD = today;
      u.notifications.todaySent = 0;
    }
    if (u.notifications.todaySent >= 3) continue;
    if (now - (u.notifications.lastAny || 0) < 6 * 3600 * 1000) continue;
    const sinceSeen = now - (u.lastSeen || 0);
    // 1. streak risk: streak >=2 and 4h or less remaining until day rollover for the user's timezone (we approximate UTC).
    if (u.streak >= 2 && u.streakRiskAt && now >= u.streakRiskAt && (now - (u.notifications.lastKind.streak_risk || 0) > 24 * 3600 * 1000) && sinceSeen > 30 * 60 * 1000) {
      await sendNotif(uid, 'streak_risk', u);
      continue;
    }
    // 2. daily challenge nudge: 18h+ away
    if (sinceSeen > 18 * 3600 * 1000 && (now - (u.notifications.lastKind.daily_challenge || 0) > 24 * 3600 * 1000)) {
      await sendNotif(uid, 'daily_challenge', u);
      continue;
    }
    // 3. comeback: 3d+ away
    if (sinceSeen > 3 * 24 * 3600 * 1000 && (now - (u.notifications.lastKind.comeback || 0) > 4 * 24 * 3600 * 1000)) {
      await sendNotif(uid, 'comeback', u);
      continue;
    }
  }
  usersDirty = true;
}

async function sendNotif(uid, kind, u) {
  const lang = (u.lang || 'en').toLowerCase();
  const isRu = lang.startsWith('ru');
  const playUrl = PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}` : '';
  const reply_markup = playUrl ? { inline_keyboard: [[{ text: isRu ? '▶️ Играть' : '▶️ Play', web_app: { url: playUrl } }]] } : undefined;
  const texts = {
    streak_risk: isRu
      ? `🔥 Твоя серия ${u.streak} дней под угрозой! Сыграй один уровень, чтобы не потерять.`
      : `🔥 Your ${u.streak}-day streak is at risk! Play one level to keep it.`,
    daily_challenge: isRu
      ? `🎴 Новый дневной вызов в Solitaire Troyka. Заходи на короткую игру!`
      : `🎴 A fresh daily challenge is live in Solitaire Troyka. Time for a quick run!`,
    comeback: isRu
      ? `👑 Скучаем по тебе! Карта приключений ждёт. Вернись и собери звёзды.`
      : `👑 We miss you! Your quest map is waiting. Come back and collect some stars.`
  };
  const text = texts[kind];
  const r = await tgCall('sendMessage', { chat_id: uid, text, reply_markup });
  if (r?.ok) {
    u.notifications.lastKind[kind] = Date.now();
    u.notifications.lastAny = Date.now();
    u.notifications.todaySent = (u.notifications.todaySent || 0) + 1;
    usersDirty = true;
  }
}

setInterval(runNotifCron, 5 * 60 * 1000);

// ---------- share-card upload ----------
app.post('/api/share/upload', express.raw({ type: 'image/png', limit: '2mb' }), (req, res) => {
  try {
    const id = crypto.randomBytes(6).toString('hex') + '.png';
    fs.writeFileSync(path.join(SHARE_DIR, id), req.body);
    const url = PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}/s/${id}` : `/s/${id}`;
    res.json({ ok: true, url });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/s/:id', (req, res) => {
  const f = path.join(SHARE_DIR, req.params.id.replace(/[^a-f0-9.]/g, ''));
  if (!fs.existsSync(f)) return res.sendStatus(404);
  res.setHeader('content-type', 'image/png');
  res.sendFile(f);
});

// ---------- shutdown ----------
function gracefulShutdown() {
  console.log('Saving and exiting...');
  persistUsers(); persistLB();
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

app.listen(PORT, () => {
  console.log(`Solitaire Troyka v${VERSION} listening on http://localhost:${PORT}`);
  console.log(`  BOT_TOKEN: ${BOT_TOKEN ? 'set' : 'NOT SET (IAP + notif disabled)'}`);
  console.log(`  PUBLIC_DOMAIN: ${PUBLIC_DOMAIN || 'NOT SET'}`);
  console.log(`  DATA_DIR: ${DATA_DIR}`);
  console.log(`  MIXPANEL: ${MIXPANEL_TOKEN ? 'set' : 'NOT SET'}`);
});
