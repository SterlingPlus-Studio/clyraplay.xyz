const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) {}

module.exports = function setupWaifus(bot, config) {
  const { toFancyText, fancyFormat, ADMIN_ID, token } = config;

  // ==================== RUTAS ====================
  const DATA_DIR = path.join(__dirname, 'data');
  const USERS_DIR = path.join(DATA_DIR, 'users');
  const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
  const TIMER_FILE = path.join(DATA_DIR, 'timer.json');
  const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
  const VENTAS_FILE = path.join(DATA_DIR, 'ventas.json');
  const CHARACTERS_DIR = path.join(__dirname, 'personajes');
  const EXCLUSIVAS_DIR = path.join(CHARACTERS_DIR, 'exclusivas');
  const WAIFU_DATA_FILE = path.join(DATA_DIR, 'waifu_data.json');
  const PERMISOS_FILE = path.join(DATA_DIR, 'permisos.json');
  const GIFS_DIR = path.join(CHARACTERS_DIR, 'gif');
  const CACHE_DIR = path.join(GIFS_DIR, '.cache480');
  const PENDING_FILE = path.join(DATA_DIR, 'pending_waifus.json');

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(USERS_DIR)) fs.mkdirSync(USERS_DIR);
  if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, '[]', 'utf8');
  if (!fs.existsSync(TIMER_FILE)) fs.writeFileSync(TIMER_FILE, JSON.stringify({ nextDropTime: 0 }), 'utf8');
  if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, '{}', 'utf8');
  if (!fs.existsSync(CHARACTERS_DIR)) fs.mkdirSync(CHARACTERS_DIR);
  if (!fs.existsSync(EXCLUSIVAS_DIR)) fs.mkdirSync(EXCLUSIVAS_DIR, { recursive: true });
  if (!fs.existsSync(PERMISOS_FILE)) fs.writeFileSync(PERMISOS_FILE, '[]', 'utf8');
  if (!fs.existsSync(GIFS_DIR)) fs.mkdirSync(GIFS_DIR);
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, '{}', 'utf8');

  // ==================== IO ATÓMICO ====================
  function atomicWriteFileSync(filePath, data) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmp = path.join(
      dir,
      `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    );
    try {
      fs.writeFileSync(tmp, data, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      throw e;
    }
  }

  function backupCorrupt(filePath, label) {
    try {
      const backup = filePath + '.corrupt-' + Date.now();
      fs.renameSync(filePath, backup);
      console.error(`[Waifus] ⚠️ ${label} corrupto. Respaldado en: ${path.basename(backup)}`);
    } catch (_) {}
  }

  // ==================== CONSTANTES ====================
  const DROP_INTERVAL = 60 * 60 * 1000;
  const CAPTURE_TIME_MS = 5 * 60 * 1000;
  const CAPTURE_TIME_MIN = Math.floor(CAPTURE_TIME_MS / 60000);
  const DELETE_AFTER_CAPTURE_MS = 60 * 1000;
  const HISTORY_LIMIT = 20;
  const MAX_RETRY = 10;
  const WAIFUS_PER_PAGE = 10;
  const SHOP_PRICE = 150;
  const SOPORTE_URL = 'https://t.me/WaifusJinx';
  const FETCH_TIMEOUT_MS = 15000;

  const DONAR_ESTRELLAS_CANTIDAD = 5;
  const DONAR_RECOMPENSA_LEGENDARIAS = 3;

  const COINS_REWARD = {
    comun: 50,
    rara: 120,
    epica: 250,
    legendaria: 500
  };

  const rarityEmojis = { comun: '🌸', rara: '🔥', epica: '💎', legendaria: '👑', exclusiva: '🌟' };

  const RARITY_ORDER = ['legendaria', 'comun', 'rara', 'epica', 'exclusiva'];
  const RARITY_LABELS = {
    legendaria: 'Legendaria',
    comun: 'Común',
    rara: 'Rara',
    epica: 'Épica',
    exclusiva: 'Exclusiva'
  };

  // ==================== 🛡️ CONSTANTES DE SEGURIDAD (LIMPIEZA) ====================
  const MIN_HEALTHY_POOL_SIZE = 20;
  const MAX_USER_LOSS_PERCENT = 90;
  const MIN_WAIFUS_TO_APPLY_LOSS_LIMIT = 3;

  async function retryAsync(fn, maxAttempts = 3, baseDelay = 1000) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try { return await fn(); }
      catch (err) {
        lastErr = err;
        const errMsg = err?.message || String(err);
        const isNetworkErr = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout/i.test(errMsg);
        console.error(`⚠️ [Waifus] Intento ${attempt}/${maxAttempts} falló${isNetworkErr ? ' (red)' : ''}:`, errMsg);
        if (attempt < maxAttempts) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  async function safeReplyWithPhoto(ctx, photo, options) { return retryAsync(() => ctx.replyWithPhoto(photo, options), 3, 1500); }
  async function safeReplyWithVideo(ctx, video, options) { return retryAsync(() => ctx.replyWithVideo(video, options), 3, 1500); }
  async function safeReplyWithAnimation(ctx, anim, options) { return retryAsync(() => ctx.replyWithAnimation(anim, options), 3, 1500); }
  async function safeReply(ctx, text, options) { return retryAsync(() => ctx.reply(text, options), 3, 1500); }
  async function safeSendPhoto(chatId, photo, options) { return retryAsync(() => bot.telegram.sendPhoto(chatId, photo, options), 3, 1500); }
  async function safeSendMessage(chatId, text, options) { return retryAsync(() => bot.telegram.sendMessage(chatId, text, options), 3, 1500); }
  function safeAnswerCb(ctx, text, extra) { return ctx.answerCbQuery(text, extra).catch(() => {}); }

  async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const DEFAULT_POOL = {
    comun: { weight: 50, characters: [
      'Asuka Langley', 'Rei Ayanami', 'Mikasa Ackerman', 'Nami', 'Bulma',
      'Sakura Haruno', 'Erza Scarlet', 'Mabel Pines', 'Videl',
      'C.C.', 'Hinata Hyuga', 'Ino Yamanaka', 'Tenten', 'Temari',
      'Rukia Kuchiki', 'Orihime Inoue', 'Nico Robin',
      'Nobara Kugisaki', 'Maki Zenin', 'Kasumi Miwa', 'Mai Zenin',
      'Momo Yaoyorozu', 'Kyoka Jiro', 'Tsuyu Asui', 'Ochaco Uraraka',
      'Mina Ashido', 'Panty', 'Stocking'
    ]},
    rara: { weight: 60, characters: [
      'Zero Two', 'Rem', 'Mai Sakurajima', 'Kurisu Makise',
      'Rias Gremory', 'Wendy Corduroy', 'Esdeath', 'Ram',
      'Lucy Heartfilia', 'Mereoleona Vermillion', 'Noelle Silva',
      'Charmy Pappitson', 'Vanessa Enoteca', 'Fana', 'Mimosa Vermillion',
      'Yuno Grinberryall', 'Asta', 'Sylph', 'Nero',
      'Shoko Komi', 'Raphtalia', 'Hestia', 'Ais Wallenstein',
      'Riveria Ljos Alf', 'Tione Hiryute', 'Tiona Hiryute',
      'Lefiya Viridis', 'Haruhime Sanjouno', 'Mikoto Yamato'
    ]},
    epica: { weight: 45, characters: [
      'Saber', 'Rin Tohsaka', 'Asuna Yuuki', 'Mikoto Misaka',
      'Yoruichi Shihouin', 'Mahiro Oyama', 'Mitsuri Kanroji', 'Makima',
      'Emilia', 'Megumin', 'Aqua', 'Darkness',
      'Yunyun', 'Wiz', 'Eris', 'Chris',
      'Ai Hayasaka', 'Kaguya Shinomiya', 'Chika Fujiwara',
      'Miko Iino', 'Kei Shirogane', 'Maki Shijo',
      'Yukino Yukinoshita', 'Yui Yuigahama', 'Iroha Isshiki',
      'Haruno Yukinoshita', 'Kawasaki Saki'
    ]},
    legendaria: { weight: 25, characters: [
      'Holo', 'Violet Evergarden', 'Hitagi Senjougahara',
      'Frieren', 'Kanna Kamui', 'Himiko Toga',
      'Anya Forger', 'Yor Forger', 'Loid Forger',
      'Bond Forger', 'Fiona Frost', 'Sylvia Sherwood',
      'Shinobu Oshino', 'Ougi Oshino', 'Mayoi Hachikuji',
      'Tsubasa Hanekawa', 'Suruga Kanbaru', 'Karen Araragi',
      'Tsukihi Araragi', 'Koyomi Araragi', 'Sodachi Oikura',
      'Ritsu Tainaka', 'Mio Akiyama', 'Azusa Nakano',
      'Yui Hirasawa', 'Sawako Yamanaka', 'Ui Hirasawa'
    ]}
  };

  const DEFAULT_SERIES = {
    'Asuka Langley': 'Neon Genesis Evangelion', 'Rei Ayanami': 'Neon Genesis Evangelion',
    'Mikasa Ackerman': 'Attack on Titan', 'Nami': 'One Piece', 'Bulma': 'Dragon Ball',
    'Sakura Haruno': 'Naruto', 'Lucy Heartfilia': 'Fairy Tail', 'Erza Scarlet': 'Fairy Tail',
    'Mabel Pines': 'Gravity Falls', 'Videl': 'Dragon Ball', 'Anya Forger': 'Spy x Family',
    'Wendy Corduroy': 'Gravity Falls', 'Esdeath': 'Akame ga Kill', 'Ram': 'Re:Zero',
    'Zero Two': 'Darling in the Franxx', 'Rem': 'Re:Zero', 'Emilia': 'Re:Zero',
    'Mai Sakurajima': 'Seishun Buta Yarou', 'Kurisu Makise': 'Steins;Gate',
    'Rias Gremory': 'High School DxD', 'Saber': 'Fate/stay night', 'Rin Tohsaka': 'Fate/stay night',
    'Asuna Yuuki': 'Sword Art Online', 'Mikoto Misaka': 'Toaru Kagaku no Railgun',
    'Yoruichi Shihouin': 'Bleach', 'Mahiro Oyama': 'Onimai', 'Holo': 'Spice and Wolf',
    'C.C.': 'Code Geass', 'Violet Evergarden': 'Violet Evergarden',
    'Hitagi Senjougahara': 'Monogatari Series', 'Frieren': 'Sousou no Frieren',
    'Kanna Kamui': 'Miss Kobayashi\'s Dragon Maid', 'Mitsuri Kanroji': 'Demon Slayer',
    'Makima': 'Chainsaw Man', 'Himiko Toga': 'My Hero Academia', 'Hinata Hyuga': 'Naruto',
    'Ino Yamanaka': 'Naruto', 'Tenten': 'Naruto', 'Temari': 'Naruto', 'Rukia Kuchiki': 'Bleach',
    'Orihime Inoue': 'Bleach', 'Nico Robin': 'One Piece', 'Nobara Kugisaki': 'Jujutsu Kaisen',
    'Maki Zenin': 'Jujutsu Kaisen', 'Kasumi Miwa': 'Jujutsu Kaisen', 'Mai Zenin': 'Jujutsu Kaisen',
    'Momo Yaoyorozu': 'My Hero Academia', 'Kyoka Jiro': 'My Hero Academia',
    'Tsuyu Asui': 'My Hero Academia', 'Ochaco Uraraka': 'My Hero Academia',
    'Mina Ashido': 'My Hero Academia', 'Panty': 'Panty & Stocking', 'Stocking': 'Panty & Stocking',
    'Mereoleona Vermillion': 'Black Clover', 'Noelle Silva': 'Black Clover',
    'Charmy Pappitson': 'Black Clover', 'Vanessa Enoteca': 'Black Clover', 'Fana': 'Black Clover',
    'Mimosa Vermillion': 'Black Clover', 'Yuno Grinberryall': 'Black Clover', 'Asta': 'Black Clover',
    'Sylph': 'Black Clover', 'Nero': 'Black Clover', 'Shoko Komi': 'Komi Can\'t Communicate',
    'Raphtalia': 'The Rising of the Shield Hero', 'Hestia': 'DanMachi',
    'Ais Wallenstein': 'DanMachi', 'Riveria Ljos Alf': 'DanMachi', 'Tione Hiryute': 'DanMachi',
    'Tiona Hiryute': 'DanMachi', 'Lefiya Viridis': 'DanMachi', 'Haruhime Sanjouno': 'DanMachi',
    'Mikoto Yamato': 'DanMachi', 'Megumin': 'Konosuba', 'Aqua': 'Konosuba', 'Darkness': 'Konosuba',
    'Yunyun': 'Konosuba', 'Wiz': 'Konosuba', 'Eris': 'Konosuba', 'Chris': 'Konosuba',
    'Ai Hayasaka': 'Kaguya-sama', 'Kaguya Shinomiya': 'Kaguya-sama', 'Chika Fujiwara': 'Kaguya-sama',
    'Miko Iino': 'Kaguya-sama', 'Kei Shirogane': 'Kaguya-sama', 'Maki Shijo': 'Kaguya-sama',
    'Yukino Yukinoshita': 'Oregairu', 'Yui Yuigahama': 'Oregairu', 'Iroha Isshiki': 'Oregairu',
    'Haruno Yukinoshita': 'Oregairu', 'Kawasaki Saki': 'Oregairu', 'Yor Forger': 'Spy x Family',
    'Loid Forger': 'Spy x Family', 'Bond Forger': 'Spy x Family', 'Fiona Frost': 'Spy x Family',
    'Sylvia Sherwood': 'Spy x Family', 'Shinobu Oshino': 'Monogatari', 'Ougi Oshino': 'Monogatari',
    'Mayoi Hachikuji': 'Monogatari', 'Tsubasa Hanekawa': 'Monogatari', 'Suruga Kanbaru': 'Monogatari',
    'Karen Araragi': 'Monogatari', 'Tsukihi Araragi': 'Monogatari', 'Koyomi Araragi': 'Monogatari',
    'Sodachi Oikura': 'Monogatari', 'Ritsu Tainaka': 'K-ON!', 'Mio Akiyama': 'K-ON!',
    'Azusa Nakano': 'K-ON!', 'Yui Hirasawa': 'K-ON!', 'Sawako Yamanaka': 'K-ON!', 'Ui Hirasawa': 'K-ON!'
  };

  let waifuPool = {};
  let waifuSeries = {};
  let waifuDataLoadedFromFile = false;

  function loadWaifuData() {
    waifuDataLoadedFromFile = false;

    if (fs.existsSync(WAIFU_DATA_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(WAIFU_DATA_FILE, 'utf8'));
        if (!data || typeof data !== 'object' || !data.pool || !data.series) throw new Error('formato inválido');

        let totalChars = 0;
        for (const r in data.pool) {
          if (Array.isArray(data.pool[r]?.characters)) totalChars += data.pool[r].characters.length;
        }
        if (totalChars < MIN_HEALTHY_POOL_SIZE) {
          throw new Error(`pool con muy pocos personajes (${totalChars}) — posible corrupción`);
        }

        waifuPool = data.pool;
        waifuSeries = data.series;
        waifuDataLoadedFromFile = true;
        return;
      } catch (e) {
        console.error('[Waifus] ⚠️ waifu_data.json corrupto. Usando defaults:', e.message);
        backupCorrupt(WAIFU_DATA_FILE, 'waifu_data.json');
      }
    }

    waifuPool = JSON.parse(JSON.stringify(DEFAULT_POOL));
    waifuSeries = JSON.parse(JSON.stringify(DEFAULT_SERIES));
    waifuDataLoadedFromFile = false;
    saveWaifuData();
  }
  function saveWaifuData() {
    try {
      atomicWriteFileSync(WAIFU_DATA_FILE, JSON.stringify({ pool: waifuPool, series: waifuSeries }, null, 2));
      return true;
    } catch (e) {
      console.error('[Waifus] ❌ saveWaifuData:', e.message);
      return false;
    }
  }

  function loadPermisos() {
    try {
      const p = JSON.parse(fs.readFileSync(PERMISOS_FILE, 'utf8'));
      return Array.isArray(p) ? p : [];
    } catch (e) {
      console.error('[Waifus] ⚠️ permisos.json corrupto:', e.message);
      backupCorrupt(PERMISOS_FILE, 'permisos.json');
      return [];
    }
  }
  function savePermisos(p) {
    try {
      atomicWriteFileSync(PERMISOS_FILE, JSON.stringify(p, null, 2));
      return true;
    } catch (e) {
      console.error('[Waifus] ❌ savePermisos:', e.message);
      return false;
    }
  }
  function isAuthorized(userId) { return userId === ADMIN_ID || loadPermisos().includes(userId); }

  function loadHistory() {
    try {
      const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      return (h && typeof h === 'object' && !Array.isArray(h)) ? h : {};
    } catch (e) {
      console.error('[Waifus] ⚠️ history.json corrupto:', e.message);
      backupCorrupt(HISTORY_FILE, 'history.json');
      return {};
    }
  }
  function saveHistory(h) {
    try {
      atomicWriteFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
      return true;
    } catch (e) {
      console.error('[Waifus] ❌ saveHistory:', e.message);
      return false;
    }
  }
  function getChatHistory(chatId) { return loadHistory()[chatId] || []; }
  function updateChatHistory(chatId, name) {
    const h = loadHistory();
    if (!h[chatId]) h[chatId] = [];
    h[chatId].push(name);
    if (h[chatId].length > HISTORY_LIMIT) h[chatId].shift();
    saveHistory(h);
  }
  function getRecentWaifus(chatId, n = 5) { return getChatHistory(chatId).slice(-n); }

  function getUserDataFile(userId) { return path.join(USERS_DIR, `${userId}.json`); }

  function loadUserData(userId) {
    const file = getUserDataFile(userId);
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data || typeof data !== 'object') throw new Error('formato inválido');
        if (typeof data.coins !== 'number' || !Number.isFinite(data.coins)) data.coins = 0;
        if (!Array.isArray(data.waifus)) data.waifus = [];
        if (!Array.isArray(data.covers)) data.covers = [];
        if (!Array.isArray(data.coversOff)) data.coversOff = [];
        if (!Array.isArray(data.skins)) data.skins = [];
        if (!Array.isArray(data.skinsOff)) data.skinsOff = [];
        if (typeof data.predeterminada !== 'string' && data.predeterminada !== null) data.predeterminada = null;
        if (typeof data.plusExpiresAt !== 'number') data.plusExpiresAt = 0;
        return data;
      } catch (e) {
        console.error(`[Waifus] ⚠️ Usuario ${userId} con JSON corrupto. Respaldando:`, e.message);
        backupCorrupt(file, `user ${userId}`);
      }
    }
    return { waifus: [], name: null, username: null, coins: 0, covers: [], coversOff: [], skins: [], skinsOff: [], predeterminada: null, plusExpiresAt: 0 };
  }

  function saveUserData(userId, data, firstName = null, username = null) {
    try {
      if (firstName !== null) data.name = firstName;
      if (username !== null) data.username = username;
      atomicWriteFileSync(getUserDataFile(userId), JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      console.error(`[Waifus] ❌ saveUserData(${userId}):`, e.message);
      return false;
    }
  }

  // ==================== CHATS ====================
  function loadChatIds() {
    try {
      const d = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
      if (!Array.isArray(d)) {
        console.error('[Waifus] ⚠️ chats.json no es un array; se normalizará.');
        atomicWriteFileSync(CHATS_FILE, '[]');
        return [];
      }

      const normalized = [];
      const seen = new Set();
      for (const value of d) {
        if (value == null || value === '') continue;
        const id = String(value).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        normalized.push(id);
      }

      const alreadyNormalized = d.length === normalized.length &&
        d.every((value, index) => typeof value === 'string' && value === normalized[index]);
      if (!alreadyNormalized) {
        atomicWriteFileSync(CHATS_FILE, JSON.stringify(normalized, null, 2));
        console.log(`[Waifus] 🧹 chats.json normalizado: ${d.length} entradas → ${normalized.length} chats únicos.`);
      }
      return normalized;
    } catch (e) {
      console.error('[Waifus] ⚠️ chats.json corrupto:', e.message);
      backupCorrupt(CHATS_FILE, 'chats.json');
      try { atomicWriteFileSync(CHATS_FILE, '[]'); } catch (_) {}
      return [];
    }
  }

  let _chatsCache = null;
  let _chatsCacheVersion = null;

  function getChatsFileVersion() {
    try {
      const stat = fs.statSync(CHATS_FILE);
      return `${stat.ino}:${stat.mtimeMs}:${stat.size}`;
    } catch (_) {
      return 'missing';
    }
  }

  function getChatsCache() {
    const version = getChatsFileVersion();
    if (_chatsCache === null || version !== _chatsCacheVersion) {
      _chatsCache = new Set(loadChatIds().map(String));
      _chatsCacheVersion = getChatsFileVersion();
    }
    return _chatsCache;
  }

  function saveChatId(chatId) {
    if (chatId == null || chatId === '') return;
    const key = String(chatId).trim();
    if (!key) return;
    const cache = getChatsCache();
    if (cache.has(key)) return;

    cache.add(key);
    try {
      atomicWriteFileSync(CHATS_FILE, JSON.stringify([...cache], null, 2));
      _chatsCacheVersion = getChatsFileVersion();
      console.log(`[Waifus] ➕ Chat registrado: ${key}`);
    } catch (e) {
      cache.delete(key);
      _chatsCacheVersion = null;
      console.error('[Waifus] ❌ saveChatId:', e.message);
    }
  }

  function removeChatId(chatId) {
    if (chatId == null || chatId === '') return;
    const key = String(chatId).trim();
    const cache = getChatsCache();
    const had = cache.delete(key);
    if (!had) return;
    try {
      atomicWriteFileSync(CHATS_FILE, JSON.stringify([...cache], null, 2));
      _chatsCacheVersion = getChatsFileVersion();
    } catch (e) {
      cache.add(key);
      _chatsCacheVersion = null;
      console.error('[Waifus] ❌ removeChatId:', e.message);
    }
  }

  bot.use((ctx, next) => {
    try {
      if (ctx.chat && ctx.chat.type !== 'private') {
        saveChatId(ctx.chat.id);
      }
    } catch (_) {}
    return next();
  });

  // ==================== CONTEO REAL DE WAIFUS ====================
  function loadVentasSafe() {
    try {
      if (!fs.existsSync(VENTAS_FILE)) return {};
      const d = JSON.parse(fs.readFileSync(VENTAS_FILE, 'utf8'));
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    } catch { return {}; }
  }

  function countOwnedWaifus(userId) {
    const ud = loadUserData(userId);
    const arr = Array.isArray(ud.waifus) ? ud.waifus : [];

    const uniqueSet = new Set();
    for (const w of arr) {
      if (w && w.name) uniqueSet.add(String(w.name).toLowerCase());
    }

    let onSale = 0;
    try {
      const ventas = loadVentasSafe();
      for (const v of Object.values(ventas)) {
        if (v && v.sellerId === userId && v.status === 'active') onSale++;
      }
    } catch (_) {}

    return {
      total: arr.length,
      unique: uniqueSet.size,
      onSale
    };
  }

  // ============================================================
  // 🧹 LIMPIEZA AUTOMÁTICA SEGURA DE PERFILES
  // ============================================================

  function waifuExistsInSystem(name) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (findWaifuByName(trimmed)) return true;
    if (findExclusiveWaifu(trimmed)) return true;
    return false;
  }

  function isSystemHealthy() {
    try {
      if (!waifuPool || typeof waifuPool !== 'object') return false;
      let total = 0;
      for (const r in waifuPool) {
        if (Array.isArray(waifuPool[r]?.characters)) total += waifuPool[r].characters.length;
      }
      return total >= MIN_HEALTHY_POOL_SIZE;
    } catch (_) {
      return false;
    }
  }

  function cleanupOrphanedWaifus(options = {}) {
    const {
      specificName = null,
      dryRun = false,
      force = false,
      maxUserLossPercent = MAX_USER_LOSS_PERCENT
    } = options;

    const result = {
      usersAffected: 0,
      usersSkipped: 0,
      totalRemoved: 0,
      removedNames: new Set(),
      details: [],
      dryRun,
      aborted: false,
      abortReason: null,
      healthCheckPassed: false
    };

    const healthy = isSystemHealthy();
    result.healthCheckPassed = healthy;

    if (!healthy && !force) {
      result.aborted = true;
      result.abortReason = 'sistema no saludable (pool vacío o con muy pocos personajes)';
      console.warn('[Waifus] 🛡️ Limpieza ABORTADA: pool no saludable.');
      return result;
    }

    if (!specificName && !force && !waifuDataLoadedFromFile) {
      result.aborted = true;
      result.abortReason = 'waifu_data.json no se cargó desde archivo (posible corrupción)';
      console.warn('[Waifus] 🛡️ Limpieza global ABORTADA: waifu_data.json no confiable.');
      return result;
    }

    if (specificName && waifuExistsInSystem(specificName) && !force) {
      result.aborted = true;
      result.abortReason = `la waifu "${specificName}" aún existe en el sistema`;
      console.warn(`[Waifus] 🛡️ Limpieza ABORTADA: "${specificName}" existe en el sistema.`);
      return result;
    }

    try {
      const files = fs.readdirSync(USERS_DIR)
        .filter(f => f.endsWith('.json') && !f.includes('.bak') && !f.includes('.corrupt') && !f.includes('.tmp'));

      const onlyName = specificName ? String(specificName).trim().toLowerCase() : null;

      for (const file of files) {
        const userId = parseInt(file.replace('.json', ''), 10);
        if (isNaN(userId)) continue;

        const filePath = path.join(USERS_DIR, file);
        let data;
        try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
        catch (_) { continue; }
        if (!data || typeof data !== 'object') continue;
        if (!Array.isArray(data.waifus) || data.waifus.length === 0) continue;

        const originalCount = data.waifus.length;
        const removedForUser = [];

        const newWaifus = data.waifus.filter(w => {
          if (!w || !w.name) return false;
          const wName = String(w.name);

          if (onlyName && wName.trim().toLowerCase() !== onlyName) return true;

          const exists = waifuExistsInSystem(wName);
          if (!exists) {
            removedForUser.push(wName);
            result.removedNames.add(wName);
          }
          return exists;
        });

        const removed = originalCount - newWaifus.length;
        if (removed <= 0) continue;

        if (!onlyName) {
          const lossPercent = (removed / originalCount) * 100;
          if (originalCount >= MIN_WAIFUS_TO_APPLY_LOSS_LIMIT && lossPercent >= maxUserLossPercent) {
            result.usersSkipped++;
            console.warn(
              `[Waifus] 🛡️ Usuario ${userId} OMITIDO en limpieza: ` +
              `perdería ${removed}/${originalCount} (${lossPercent.toFixed(1)}%)`
            );
            continue;
          }
        }

        if (dryRun) {
          result.usersAffected++;
          result.totalRemoved += removed;
          result.details.push({ userId, removed, names: removedForUser, dryRun: true });
          continue;
        }

        try {
          const backupPath = filePath + '.bak-cleanup-' + Date.now();
          fs.copyFileSync(filePath, backupPath);
        } catch (e) {
          console.error(`[Waifus] ❌ No se pudo respaldar perfil ${userId}, se omite:`, e.message);
          result.usersSkipped++;
          continue;
        }

        data.waifus = newWaifus;

        if (data.predeterminada) {
          const stillHas = data.waifus.some(w => w.name === data.predeterminada);
          if (!stillHas) data.predeterminada = null;
        }

        try {
          atomicWriteFileSync(filePath, JSON.stringify(data, null, 2));
          result.usersAffected++;
          result.totalRemoved += removed;
          result.details.push({ userId, removed, names: removedForUser });
        } catch (e) {
          console.error(`[Waifus] ❌ Error limpiando perfil ${userId}:`, e.message);
          result.usersSkipped++;
        }
      }
    } catch (e) {
      console.error('[Waifus] ❌ Error en cleanupOrphanedWaifus:', e.message);
      result.aborted = true;
      result.abortReason = e.message;
    }

    return result;
  }

  // ==================== RESTO DEL MÓDULO ====================
  function getNextDropTime() {
    try { return JSON.parse(fs.readFileSync(TIMER_FILE, 'utf8')).nextDropTime || 0; }
    catch { return 0; }
  }
  function setNextDropTime(t) {
    try { atomicWriteFileSync(TIMER_FILE, JSON.stringify({ nextDropTime: t }, null, 2)); }
    catch (e) { console.error('[Waifus] ❌ setNextDropTime:', e.message); }
  }

  function getRandomWaifuWithHistory(chatId) {
    const history = getChatHistory(chatId);
    const recent = getRecentWaifus(chatId, 5);
    if (history.length < 3) return getRandomWaifu();
    for (let i = 0; i < MAX_RETRY; i++) {
      const c = getRandomWaifu();
      if (!recent.includes(c.name)) return c;
    }
    const rarityCount = { comun: 0, rara: 0, epica: 0, legendaria: 0 };
    for (const name of recent) { const f = findWaifuByName(name); if (f) rarityCount[f.rarity]++; }
    const sorted = Object.keys(rarityCount).sort((a, b) => rarityCount[a] - rarityCount[b]);
    for (const r of sorted) {
      const list = waifuPool[r]?.characters || [];
      if (!list.length) continue;
      const name = list[Math.floor(Math.random() * list.length)];
      if (!recent.includes(name)) return { name, rarity: r };
    }
    return getRandomWaifu();
  }
  function getRandomWaifu() {
    let totalWeight = 0;
    for (const r in waifuPool) totalWeight += waifuPool[r].weight;
    const rand = Math.random() * totalWeight;
    let cum = 0, sel = 'comun';
    for (const r in waifuPool) { cum += waifuPool[r].weight; if (rand <= cum) { sel = r; break; } }
    const chars = waifuPool[sel].characters;
    return { name: chars[Math.floor(Math.random() * chars.length)], rarity: sel };
  }
  function findWaifuByName(name) {
    const lower = String(name).toLowerCase();
    for (const r in waifuPool) {
      const found = waifuPool[r].characters.find(c => c.toLowerCase() === lower);
      if (found) return { name: found, rarity: r };
    }
    return null;
  }
  function getAllWaifuNames() {
    const all = [];
    for (const r in waifuPool) all.push(...waifuPool[r].characters);
    return all;
  }

  function findExclusiveWaifu(name) {
    const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    for (const ext of exts) {
      const fp = path.join(EXCLUSIVAS_DIR, name + ext);
      if (fs.existsSync(fp)) return { name, file: fp, ext };
    }
    return null;
  }
  function listExclusiveNames() {
    try {
      const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      return fs.readdirSync(EXCLUSIVAS_DIR)
        .filter(f => exts.some(e => f.toLowerCase().endsWith(e)))
        .map(f => path.basename(f, path.extname(f)));
    } catch { return []; }
  }

  function findCharacterImage(waifuName) {
    const exts = ['.png', '.jpg', '.jpeg', '.gif'];
    for (const ext of exts) {
      const fp = path.join(CHARACTERS_DIR, waifuName + ext);
      if (fs.existsSync(fp)) return fp;
    }
    const excl = findExclusiveWaifu(waifuName);
    if (excl) return excl.file;
    return null;
  }
  function findShopImage() {
    const exts = ['.png', '.jpg', '.jpeg', '.gif'];
    for (const ext of exts) {
      const fp = path.join(CHARACTERS_DIR, 'tienda' + ext);
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  }

  function loadShopItems() {
    if (!fs.existsSync(GIFS_DIR)) fs.mkdirSync(GIFS_DIR, { recursive: true });
    const files = fs.readdirSync(GIFS_DIR).filter(f => /\.(gif|mp4|png|jpg|jpeg|webp)$/i.test(f));
    return files.map(file => {
      const ext = path.extname(file);
      const baseName = path.basename(file, ext);
      let displayName = baseName;
      const m = baseName.match(/_(\d+)$/);
      if (m) displayName = baseName.replace(/_\d+$/, '');
      return { id: displayName, file: path.join(GIFS_DIR, file), name: displayName, price: SHOP_PRICE };
    });
  }
  function getShopItemById(coverId) { return loadShopItems().find(i => i.id === coverId) || null; }
  function isAnimationFile(fp) { const e = path.extname(fp).toLowerCase(); return e === '.gif' || e === '.mp4' || e === '.webp'; }

  function getCacheKey(filePath) {
    const stat = fs.statSync(filePath);
    const hash = crypto.createHash('md5').update(filePath + '|' + stat.mtimeMs + '|' + stat.size + '|480p-audio-full').digest('hex');
    return hash + '.mp4';
  }

  function compressTo480(inputPath) {
    return new Promise((resolve, reject) => {
      if (!ffmpegPath) return reject(new Error('ffmpeg no disponible'));
      const outputPath = path.join(CACHE_DIR, getCacheKey(inputPath));
      if (fs.existsSync(outputPath)) return resolve(outputPath);
      const args = ['-i', inputPath, '-vf', "scale='min(480,iw)':-2:flags=lanczos", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-y', outputPath];
      execFile(ffmpegPath, args, { timeout: 300000, maxBuffer: 1024 * 1024 * 100 }, (err) => {
        if (err) { try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {} return reject(err); }
        resolve(outputPath);
      });
    });
  }

  function formatFecha(ts) {
    try {
      return new Date(ts).toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    } catch {
      return new Date(ts).toLocaleString();
    }
  }

  function generarRanking(top10, total) {
    const emojis = ['👑', '🧡', '💛', '💚', '🩵', '💙', '💜', '🤎', '🖤', '🤍'];
    let msg = toFancyText('🌍 ᴛᴏᴘ 10 ᴜꜱᴜᴀʀɪᴏꜱ ᴄᴏɴ ᴍÁꜱ ᴡᴀɪғᴜꜱ 🏆\n┃\n');
    top10.forEach((u, i) => {
      const extra = u.unique !== u.count ? ` (${u.unique} únicas)` : '';
      msg += `┣ ${emojis[i] || '❤️'} ${u.display} : ${u.count}${extra}\n`;
    });
    msg += fancyFormat`\n💕 ᴛᴏᴛᴀʟ ᴅᴇ ᴡᴀɪғᴜꜱ ᴄᴀᴘᴛᴜʀᴀᴅᴀꜱ: ${total}`;
    return msg;
  }

  function generarBotonesConNombres(correctName) {
    const todos = getAllWaifuNames();
    const otros = todos.filter(n => n !== correctName);
    const incorrectos = [];
    const copia = [...otros];
    for (let i = 0; i < 3 && copia.length > 0; i++) {
      const idx = Math.floor(Math.random() * copia.length);
      incorrectos.push(copia.splice(idx, 1)[0]);
    }
    return [correctName, ...incorrectos].sort(() => Math.random() - 0.5);
  }

  // ============================================================
  // GESTIÓN DE WAIFUS PENDIENTES
  // ============================================================
  const pendingWaifus = {};
  const collectionSessions = {};

  function persistPending() {
    try {
      const data = {};
      for (const [sid, p] of Object.entries(pendingWaifus)) {
        if (!p) continue;
        data[sid] = {
          sessionId: p.sessionId,
          chatId: p.chatId,
          waifu: p.waifu,
          expiresAt: p.expiresAt,
          isPhoto: p.isPhoto,
          messageId: p.messageId || null,
          botones: p.botones,
          correctName: p.correctName,
          attemptedUsers: p.attemptedUsers || [],
          isTest: !!p.isTest
        };
      }
      atomicWriteFileSync(PENDING_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[Waifus] ❌ persistPending:', e.message);
    }
  }

  function loadPendingFromDisk() {
    try {
      const d = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'));
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    } catch (e) {
      console.error('[Waifus] ⚠️ pending_waifus.json corrupto:', e.message);
      backupCorrupt(PENDING_FILE, 'pending_waifus.json');
      return {};
    }
  }

  function attachExpireTimer(pending) {
    const sessionId = pending.sessionId;
    const remaining = Math.max(0, pending.expiresAt - Date.now());
    const timer = setTimeout(() => {
      const p = pendingWaifus[sessionId];
      if (!p) return;
      if (!p.messageId) {
        delete pendingWaifus[sessionId];
        persistPending();
        return;
      }
      const texto = toFancyText('⏰ ¡Tiempo agotado! La waifu ha escapado sin ser capturada.');
      const promise = p.isPhoto
        ? bot.telegram.editMessageCaption(p.chatId, p.messageId, undefined, texto)
        : bot.telegram.editMessageText(p.chatId, p.messageId, undefined, texto);
      promise.then(() => borrarMensajeDespues(p.chatId, p.messageId)).catch(() => {});
      delete pendingWaifus[sessionId];
      persistPending();
    }, remaining);
    timer.unref?.();
    pending.timer = timer;
  }

  function restorePendingWaifus() {
    const saved = loadPendingFromDisk();
    const now = Date.now();
    let restored = 0;
    let expired = 0;
    let skipped = 0;

    for (const [sid, p] of Object.entries(saved)) {
      if (!p || typeof p !== 'object') continue;
      if (!p.sessionId || !p.chatId || !p.waifu || !Array.isArray(p.botones)) continue;

      if (!p.messageId) { skipped++; continue; }

      if (!p.expiresAt || p.expiresAt <= now) {
        const texto = toFancyText('⏰ ¡Tiempo agotado! La waifu ha escapado sin ser capturada.');
        const promise = p.isPhoto
          ? bot.telegram.editMessageCaption(p.chatId, p.messageId, undefined, texto)
          : bot.telegram.editMessageText(p.chatId, p.messageId, undefined, texto);
        promise.then(() => borrarMensajeDespues(p.chatId, p.messageId)).catch(() => {});
        expired++;
        continue;
      }

      const pending = {
        sessionId: p.sessionId,
        chatId: p.chatId,
        waifu: p.waifu,
        expiresAt: p.expiresAt,
        isPhoto: !!p.isPhoto,
        messageId: p.messageId,
        botones: p.botones,
        correctName: p.correctName,
        attemptedUsers: Array.isArray(p.attemptedUsers) ? p.attemptedUsers : [],
        isTest: !!p.isTest,
        timer: null
      };
      pendingWaifus[sid] = pending;
      attachExpireTimer(pending);
      restored++;
    }

    persistPending();
    if (restored || expired || skipped) {
      console.log(`[Waifus] 🔄 Pendientes → restauradas: ${restored}, expiradas: ${expired}, omitidas: ${skipped}`);
    }
  }

  function borrarMensajeDespues(chatId, messageId, delayMs = 5 * 60 * 1000) {
    if (chatId == null || messageId == null) return null;
    const safeDelay = Math.max(0, Number(delayMs) || 0);
    const t = setTimeout(() => {
      bot.telegram.deleteMessage(chatId, messageId).catch((e) => {
        const m = e?.message || String(e || '');
        if (/message to delete not found|message identifier is not specified/i.test(m)) return;
        if (/not enough rights|CHAT_WRITE_FORBIDDEN|chat not found|bot was blocked/i.test(m)) {
          console.warn(`[Waifus] ⚠️ Sin permisos para borrar chat=${chatId} msg=${messageId}: ${m}`);
          return;
        }
        console.warn(`[Waifus] ⚠️ deleteMessage falló: ${m}`);
      });
      delete collectionSessions[messageId];
    }, safeDelay);
    t.unref?.();
    return t;
  }

  function sendWaifuWithTimer(chatId, waifu, messageText, isTest = false) {
    const opciones = generarBotonesConNombres(waifu.name);
    const emojisBotones = ['❤️', '🩵', '💚', '💜'];
    const sessionId = crypto.randomBytes(6).toString('hex');

    const inlineKeyboard = opciones.map((nombre, index) => ({
      text: `${emojisBotones[index]} ${toFancyText(nombre)}`,
      callback_data: `waifu_option_${sessionId}_${index}`
    }));
    const keyboardRows = [[inlineKeyboard[0], inlineKeyboard[1]], [inlineKeyboard[2], inlineKeyboard[3]]];
    const imagePath = findCharacterImage(waifu.name);

    const expiresAt = Date.now() + CAPTURE_TIME_MS;

    const pending = {
      sessionId,
      chatId,
      waifu,
      expiresAt,
      isPhoto: !!imagePath,
      messageId: null,
      botones: opciones,
      correctName: waifu.name,
      attemptedUsers: [],
      isTest,
      timer: null
    };
    pendingWaifus[sessionId] = pending;
    persistPending();
    attachExpireTimer(pending);

    const fancyMessage = toFancyText(messageText);

    const onSent = (messageId) => {
      const p = pendingWaifus[sessionId];
      if (!p) {
        borrarMensajeDespues(chatId, messageId);
        return;
      }
      p.messageId = messageId;
      persistPending();
    };

    const onError = (err) => {
      console.error('[Waifus] ❌ Error al enviar waifu (tras reintentos):', err.message);
      const p = pendingWaifus[sessionId];
      if (p) {
        clearTimeout(p.timer);
        delete pendingWaifus[sessionId];
        persistPending();
      }
    };

    if (imagePath) {
      safeSendPhoto(chatId, { source: imagePath }, { caption: fancyMessage, reply_markup: { inline_keyboard: keyboardRows } })
        .then(s => onSent(s.message_id))
        .catch(onError);
    } else {
      safeSendMessage(chatId, fancyMessage, { reply_markup: { inline_keyboard: keyboardRows } })
        .then(s => onSent(s.message_id))
        .catch(onError);
    }
  }

  let cachedBotPhotoFileId = null;
  const bienvenidaReciente = new Map();
  const BIENVENIDA_DEDUP_MS = 30 * 1000;

  async function enviarBienvenidaUnaVez(ctx, chatId, nombreUsuario, showAddButton = false) {
    const key = String(chatId);
    const now = Date.now();
    const previous = bienvenidaReciente.get(key) || 0;
    if (now - previous < BIENVENIDA_DEDUP_MS) {
      console.log(`[Waifus] ⏭️ Bienvenida duplicada omitida para ${key}.`);
      return;
    }

    bienvenidaReciente.set(key, now);
    const timer = setTimeout(() => {
      if (bienvenidaReciente.get(key) === now) bienvenidaReciente.delete(key);
    }, BIENVENIDA_DEDUP_MS);
    timer.unref?.();

    try {
      await enviarBienvenida(ctx, chatId, nombreUsuario, showAddButton);
    } catch (e) {
      if (bienvenidaReciente.get(key) === now) bienvenidaReciente.delete(key);
      throw e;
    }
  }

  async function enviarBienvenida(ctx, chatId, nombreUsuario, showAddButton = false) {
    const mensaje = fancyFormat`✨ ¡Hola, ${nombreUsuario}! ✨

🤖 Soy un bot de captura de waifus.

🎯 Cada 1 hora aparecerá una waifu salvaje en este grupo/canal.
⏳ Tienes ${CAPTURE_TIME_MIN} minutos para adivinar su nombre y capturarla.

💰 Cada captura te da monedas según la rareza.
🏪 Úsalas en la tienda para comprar portadas animadas.

¡Buena suerte! 🍀`;
    const botUsername = ctx.botInfo?.username || (await bot.telegram.getMe().catch(() => ({ username: '' }))).username;

    const buttons = [
      [
        { text: toFancyText('⭐ Apoya el bot'), callback_data: 'donar_estrellas' },
        { text: toFancyText('🆘 Soporte'), url: SOPORTE_URL }
      ]
    ];

    if (showAddButton) {
      buttons.push([
        { text: toFancyText('📋 Comandos'), callback_data: 'comandos' },
        { text: toFancyText('➕ Agregar a un grupo'), url: `https://t.me/${botUsername}?startgroup=true` }
      ]);
    } else {
      buttons.push([
        { text: toFancyText('📋 Comandos'), callback_data: 'comandos' }
      ]);
    }

    const extra = { reply_markup: { inline_keyboard: buttons } };

    try {
      if (cachedBotPhotoFileId) {
        const sent = await safeSendPhoto(chatId, cachedBotPhotoFileId, { caption: mensaje, ...extra });
        if (ctx.chat.type !== 'private') borrarMensajeDespues(chatId, sent.message_id);
        return;
      }
    } catch (_) { cachedBotPhotoFileId = null; }

    try {
      const botInfo = await bot.telegram.getMe();
      const photos = await bot.telegram.getUserProfilePhotos(botInfo.id);
      let sent;
      if (photos.total_count > 0) {
        cachedBotPhotoFileId = photos.photos[0][0].file_id;
        sent = await safeSendPhoto(chatId, cachedBotPhotoFileId, { caption: mensaje, ...extra });
      } else {
        sent = await safeSendMessage(chatId, mensaje, extra);
      }
      if (ctx.chat.type !== 'private') borrarMensajeDespues(chatId, sent.message_id);
    } catch (e) {
      try {
        const sent = await safeSendMessage(chatId, mensaje, extra);
        if (ctx.chat.type !== 'private') borrarMensajeDespues(chatId, sent.message_id);
      } catch (_) {}
    }
  }

  // ==================== ⭐ PAGO CON ESTRELLAS ====================
  bot.action('donar_estrellas', async (ctx) => {
    safeAnswerCb(ctx);
    try {
      await bot.telegram.sendInvoice(ctx.chat.id, {
        title: '⭐ Apoya el bot',
        description: `¡Apoya al bot con ${DONAR_ESTRELLAS_CANTIDAD} estrellas y recibe ${DONAR_RECOMPENSA_LEGENDARIAS} waifus LEGENDARIAS de regalo! 💖`,
        payload: 'donacion_estrellas_' + Date.now(),
        provider_token: '',
        currency: 'XTR',
        prices: [
          { label: `⭐ Apoyo + ${DONAR_RECOMPENSA_LEGENDARIAS} legendarias`, amount: DONAR_ESTRELLAS_CANTIDAD }
        ],
        start_parameter: 'donar'
      });
    } catch (e) {
      console.error('[Waifus] Error enviando invoice Stars:', e.message);
      try {
        await ctx.reply(toFancyText('❌ No se pudo abrir el pago de estrellas. Intenta de nuevo.'));
      } catch (_) {}
    }
  });

  bot.on('pre_checkout_query', async (ctx, next) => {
    try {
      const q = ctx.preCheckoutQuery;
      const payload = q && q.invoice_payload ? String(q.invoice_payload) : '';

      if (!payload.startsWith('donacion_estrellas_')) {
        return typeof next === 'function' ? next() : undefined;
      }

      await ctx.answerPreCheckoutQuery(true);
    } catch (e) {
      console.error('[Waifus] pre_checkout_query:', e.message);
      try {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: 'Error procesando el pago. Intenta de nuevo.'
        });
      } catch (_) {}
    }
  });

  bot.on('successful_payment', async (ctx, next) => {
    try {
      const payment = ctx.message && ctx.message.successful_payment;
      if (!payment) {
        return typeof next === 'function' ? next() : undefined;
      }

      const payload = String(payment.invoice_payload || '');
      if (!payload.startsWith('donacion_estrellas_')) {
        return typeof next === 'function' ? next() : undefined;
      }

      const amount = payment.total_amount;
      const userId = ctx.from.id;
      console.log(`⭐ [Stars] Donación de ${amount} estrellas de ${userId}`);

      const userData = loadUserData(userId);
      const legendaryList = (waifuPool.legendaria && Array.isArray(waifuPool.legendaria.characters))
        ? [...waifuPool.legendaria.characters]
        : [];

      const regaladas = [];
      const now = Date.now();
      const cantidadARegal = Math.min(DONAR_RECOMPENSA_LEGENDARIAS, legendaryList.length);

      for (let i = 0; i < cantidadARegal; i++) {
        const idx = Math.floor(Math.random() * legendaryList.length);
        const nombre = legendaryList.splice(idx, 1)[0];
        userData.waifus.push({ name: nombre, rarity: 'legendaria', timestamp: now });
        regaladas.push(nombre);
      }

      const ok = saveUserData(userId, userData, ctx.from.first_name, ctx.from.username || null);
      if (!ok) console.error('[Waifus] ⚠️ No se pudo guardar la recompensa del donador.');

      let listaTexto = '';
      if (regaladas.length > 0) {
        for (const n of regaladas) {
          listaTexto += `\n👑 ${toFancyText(n)}`;
        }
      } else {
        listaTexto = '\n⚠️ No hay legendarias disponibles en este momento.';
      }

      const stats = countOwnedWaifus(userId);

      const sent = await ctx.reply(fancyFormat`⭐ ¡ɢʀᴀᴄɪᴀꜱ ᴘᴏʀ ᴛᴜ ᴀᴘᴏʏᴏ!

💖 Has donado ${amount} estrellas.
🌸 Tu apoyo ayuda a mantener el bot activo.

🎁 ʀᴇᴄᴏᴍᴘᴇɴꜱᴀ:
${listaTexto}

📦 Total de waifus: ${stats.total} (${stats.unique} únicas)`);
      if (sent && sent.chat?.id) borrarMensajeDespues(sent.chat.id, sent.message_id);
    } catch (e) {
      console.error('[Waifus] successful_payment:', e.message);
    }
  });

  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    if (ctx.chat.type !== 'private') saveChatId(chatId);
    const user = ctx.from;
    const data = loadUserData(user.id);
    saveUserData(user.id, data, user.first_name, user.username || null);

    const startText = (ctx.message && ctx.message.text) || '';
    const parts = startText.trim().split(/\s+/);
    const payload = (parts.length > 1 ? parts[1] : '').toLowerCase();

    if (payload === 'caja_suprema' && config.cajas && typeof config.cajas.openCajaSuprema === 'function') {
      try {
        await config.cajas.openCajaSuprema(ctx);
      } catch (e) {
        console.error('[Waifus] Error al abrir Caja Suprema desde /start:', e.message);
      }
      return;
    }

    if (payload === 'plus' && config.tienda && typeof config.tienda.openPlus === 'function') {
      try {
        await config.tienda.openPlus(ctx);
      } catch (e) {
        console.error('[Waifus] Error al abrir Suscripción Plus desde /start:', e.message);
      }
      return;
    }

    await enviarBienvenida(ctx, chatId, user.first_name, ctx.chat.type === 'private');
  });

  bot.command('saldo', async (ctx) => {
    const chatId = ctx.chat.id;
    const userData = loadUserData(ctx.from.id);
    const stats = countOwnedWaifus(ctx.from.id);
    let extraLine = '';
    if (stats.onSale > 0) extraLine = `\n🏷️ ᴇɴ ᴠᴇɴᴛᴀ: ${stats.onSale}`;

    const msg = await safeReply(ctx, fancyFormat`💰 ᴛᴜ ꜱᴀʟᴅᴏ ᴀᴄᴛᴜᴀʟ

🪙 ${userData.coins} ᴍᴏɴᴇᴅᴀꜱ

🎨 ᴘᴏʀᴛᴀᴅᴀꜱ ᴀɴɪᴍᴀᴅᴀꜱ ᴄᴏᴍᴘʀᴀᴅᴀꜱ: ${userData.covers.length}
🖼️ sᴋɪɴꜱ ᴄᴏᴍᴘʀᴀᴅᴀꜱ: ${(userData.skins || []).length}
🍥 ᴡᴀɪғᴜꜱ: ${stats.total} (${stats.unique} únicas)${extraLine}`);
    borrarMensajeDespues(chatId, msg.message_id, 60000);
  });

  bot.command('tiempo', async (ctx) => {
    const chatId = ctx.chat.id;
    const remaining = getNextDropTime() - Date.now();
    let msgText;
    if (remaining <= 0) msgText = toFancyText('⏳ ¡La waifu está a punto de aparecer!');
    else msgText = fancyFormat`⏱️ Faltan ${Math.floor(remaining / 60000)} minutos y ${Math.floor((remaining % 60000) / 1000)} segundos para la próxima waifu.`;
    const msg = await safeReply(ctx, msgText);
    borrarMensajeDespues(chatId, msg.message_id, 30000);
  });

  // ==================== /ver CON SOPORTE DE SKINS ====================
  bot.command('ver', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const userData = loadUserData(userId);
    if (userData.waifus.length === 0) {
      const msg = await safeReply(ctx, toFancyText('Aún no tienes waifus.'));
      borrarMensajeDespues(chatId, msg.message_id);
      return;
    }
    const args = ctx.message.text.trim().split(' ');
    args.shift();
    const nombreBuscado = args.join(' ').trim().toLowerCase();
    let waifu;
    if (nombreBuscado) {
      waifu = userData.waifus.find(w => w.name.toLowerCase() === nombreBuscado);
      if (!waifu) {
        const msg = await safeReply(ctx, fancyFormat`❌ No tienes a ${toFancyText(nombreBuscado)} en tu colección.`);
        borrarMensajeDespues(chatId, msg.message_id);
        return;
      }
    } else { waifu = userData.waifus[userData.waifus.length - 1]; }

    const emoji = rarityEmojis[waifu.rarity] || '❓';
    const serie = waifuSeries[waifu.name] || (waifu.exclusive ? 'Exclusiva de subasta' : 'Desconocida');
    const fecha = formatFecha(waifu.timestamp);
    const mensaje = fancyFormat`⭐️ Información de la waifu:

${emoji} Nombre: ${toFancyText(waifu.name)}
📺 Origen: ${toFancyText(serie)}
✨ Rareza: ${toFancyText(waifu.rarity)}
🕒 Capturada: ${fecha}`;

    const extra = { reply_markup: { inline_keyboard: [[{ text: toFancyText('🎨 Mis portadas y skins'), callback_data: 'open_inv' }]] } };

    // 🖼️ 1) SKIN activa (tiene prioridad sobre la portada animada)
    let skinItem = null;
    if (config.skins && typeof config.skins.getActiveSkinForUserAndWaifu === 'function') {
      try {
        skinItem = config.skins.getActiveSkinForUserAndWaifu(userId, waifu.name);
      } catch (_) {}
    }

    // 🎨 2) Portada animada (solo si NO hay skin activa)
    const hasCover = userData.covers.includes(waifu.name);
    const isCoverOff = userData.coversOff.includes(waifu.name);
    let coverItem = null;
    if (!skinItem && hasCover && !isCoverOff) coverItem = getShopItemById(waifu.name);

    let loadingMsg = null;
    try { loadingMsg = await safeReply(ctx, toFancyText('📤 Enviando waifu...')); } catch (_) {}

    const borrarLoading = async () => {
      if (loadingMsg) { try { await bot.telegram.deleteMessage(chatId, loadingMsg.message_id); } catch (_) {} loadingMsg = null; }
    };

    let sentMessage = null;

    // 🖼️ SKIN primero (tiene prioridad sobre la portada animada)
    if (skinItem && fs.existsSync(skinItem.filePath)) {
      try {
        sentMessage = await safeReplyWithPhoto(ctx, { source: skinItem.filePath }, { caption: mensaje, ...extra });
        await borrarLoading();
        borrarMensajeDespues(chatId, sentMessage.message_id);
        return;
      } catch (e) {
        console.error('[Waifus] Error enviando skin, usando fallback:', e.message);
      }
    }

    // 🎨 Portada animada (fallback si no hay skin activa)
    if (coverItem && fs.existsSync(coverItem.file)) {
      try {
        if (isAnimationFile(coverItem.file)) {
          let fileToSend = coverItem.file;
          try { fileToSend = await compressTo480(coverItem.file); } catch (err) { console.error('Error comprimiendo, se envía original:', err.message); }
          const ext = path.extname(fileToSend).toLowerCase();
          if (ext === '.mp4') sentMessage = await safeReplyWithVideo(ctx, { source: fileToSend }, { caption: mensaje, ...extra });
          else sentMessage = await safeReplyWithAnimation(ctx, { source: fileToSend }, { caption: mensaje, ...extra });
        } else {
          sentMessage = await safeReplyWithPhoto(ctx, { source: coverItem.file }, { caption: mensaje, ...extra });
        }
      } catch (e) {
        console.error('Error enviando portada animada (tras reintentos):', e.message);
        const imagePath = findCharacterImage(waifu.name);
        try { sentMessage = imagePath ? await safeReplyWithPhoto(ctx, { source: imagePath }, { caption: mensaje, ...extra }) : await safeReply(ctx, mensaje, extra); }
        catch (e2) { console.error('Error enviando fallback:', e2.message); await borrarLoading(); return; }
      }
    } else {
      const imagePath = findCharacterImage(waifu.name);
      try { sentMessage = imagePath ? await safeReplyWithPhoto(ctx, { source: imagePath }, { caption: mensaje, ...extra }) : await safeReply(ctx, mensaje, extra); }
      catch (e) { console.error('Error enviando imagen:', e.message); await borrarLoading(); return; }
    }

    await borrarLoading();
    borrarMensajeDespues(chatId, sentMessage.message_id);
  });

  function getDisplayWaifu(userData) {
    if (userData.predeterminada) {
      const pred = userData.waifus.find(w => w.name === userData.predeterminada);
      if (pred) return { waifu: pred, isPredet: true };
    }
    const last = userData.waifus[userData.waifus.length - 1];
    return { waifu: last, isPredet: false };
  }

  function buildCollectionContent(userId, page = 0, filter = null) {
    const userData = loadUserData(userId);

    const countMap = {};
    userData.waifus.forEach(w => {
      if (!countMap[w.name]) countMap[w.name] = { count: 0, rarity: w.rarity };
      countMap[w.name].count++;
    });
    const allUniques = Object.entries(countMap).map(([name, info]) => ({ name, ...info }));

    const rarityCounts = {};
    for (const r of RARITY_ORDER) rarityCounts[r] = 0;
    for (const w of allUniques) {
      if (rarityCounts[w.rarity] == null) rarityCounts[w.rarity] = 0;
      rarityCounts[w.rarity]++;
    }

    const { waifu: displayWaifu, isPredet } = getDisplayWaifu(userData);
    const serieUltima = waifuSeries[displayWaifu.name] || (displayWaifu.exclusive ? 'Exclusiva de subasta' : 'Desconocida');
    const emojiUltima = rarityEmojis[displayWaifu.rarity] || '❓';
    const fechaUltima = formatFecha(displayWaifu.timestamp);

    const ultimaCapturada = userData.waifus[userData.waifus.length - 1];
    const emojiUltimaCap = rarityEmojis[ultimaCapturada.rarity] || '❓';

    const stats = countOwnedWaifus(userId);

    if (!filter) {
      let text = '';

      if (isPredet) {
        text += fancyFormat`📌 Última capturada: ${emojiUltimaCap} ${toFancyText(ultimaCapturada.name)}

🎴 Waifu predeterminada:
${emojiUltima} ${toFancyText(displayWaifu.name)}
📺 Origen: ${toFancyText(serieUltima)}
🕒 ${fechaUltima}`;
      } else {
        text += fancyFormat`⭐️ Última waifu capturada:
${emojiUltima} ${toFancyText(displayWaifu.name)}
📺 Origen: ${toFancyText(serieUltima)}
🕒 ${fechaUltima}`;
      }

      let totalLine = `📦 Total: ${stats.total} waifus (${stats.unique} únicas).`;
      if (stats.onSale > 0) totalLine += `\n🏷️ En venta ahora: ${stats.onSale}`;

      text += fancyFormat`

💰 Monedas: ${userData.coins}

🏆 Ranking de rarezas:

${rarityEmojis.comun} ${toFancyText('Común')}: ${rarityCounts.comun || 0}
${rarityEmojis.rara} ${toFancyText('Rara')}: ${rarityCounts.rara || 0}
${rarityEmojis.epica} ${toFancyText('Épica')}: ${rarityCounts.epica || 0}
${rarityEmojis.legendaria} ${toFancyText('Legendaria')}: ${rarityCounts.legendaria || 0}
${rarityEmojis.exclusiva} ${toFancyText('Exclusiva')}: ${rarityCounts.exclusiva || 0}

${totalLine}

💡 Escribe /predeterminada <nombre> para elegir qué waifu aparece aquí.

🎯 Selecciona una rareza para ver tus waifus:`;

      const keyboard = [];
      const rarityButtons = [];
      for (const r of RARITY_ORDER) {
        const count = rarityCounts[r] || 0;
        if (count === 0) continue;
        rarityButtons.push({
          text: `${rarityEmojis[r] || '❓'} ${toFancyText(RARITY_LABELS[r] || r)} (${count})`,
          callback_data: `col_filter_${r}`
        });
      }

      for (let i = 0; i < rarityButtons.length; i += 2) {
        const row = [rarityButtons[i]];
        if (rarityButtons[i + 1]) row.push(rarityButtons[i + 1]);
        keyboard.push(row);
      }

      return { message: text, keyboard, view: 'menu' };
    }

    const filtered = allUniques.filter(u => u.rarity === filter);
    const totalPages = Math.max(1, Math.ceil(filtered.length / WAIFUS_PER_PAGE));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * WAIFUS_PER_PAGE;
    const pageItems = filtered.slice(start, start + WAIFUS_PER_PAGE);

    let text = fancyFormat`${rarityEmojis[filter] || '❓'} ${toFancyText(RARITY_LABELS[filter] || filter)}

📦 ${filtered.length} ${toFancyText('waifus en esta categoría')}:

`;

    if (pageItems.length === 0) {
      text += fancyFormat`😢 ${toFancyText('No hay waifus aquí.')}\n`;
    } else {
      for (const item of pageItems) {
        const hasCoverActive = userData.covers.includes(item.name) && !userData.coversOff.includes(item.name);
        const hasCover = hasCoverActive ? ' 🎨' : '';
        text += fancyFormat`${rarityEmojis[item.rarity] || '❓'} ${toFancyText(item.name)} x${item.count}${hasCover}\n`;
      }
    }

    text += fancyFormat`\n${toFancyText('Página')} ${currentPage + 1}/${totalPages}`;

    const keyboard = [];

    if (totalPages > 1) {
      const navRow = [];
      navRow.push(currentPage > 0 ? { text: '⬅️', callback_data: `col_nav_${currentPage - 1}` } : { text: '⏺️', callback_data: 'col_noop' });
      navRow.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: 'col_noop' });
      navRow.push(currentPage < totalPages - 1 ? { text: '➡️', callback_data: `col_nav_${currentPage + 1}` } : { text: '⏺️', callback_data: 'col_noop' });
      keyboard.push(navRow);
    }

    keyboard.push([{ text: '⬅️ ' + toFancyText('Volver a rarezas'), callback_data: 'col_filter_all' }]);

    return { message: text, keyboard, view: 'list' };
  }

  async function enviarColeccion(ctx, userId, page = 0, filter = null) {
    const chatId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
    const userData = loadUserData(userId);
    if (userData.waifus.length === 0) {
      const msg = await safeReply(ctx, toFancyText('Aún no tienes waifus. ¡Participa cuando aparezca una waifu salvaje!'));
      borrarMensajeDespues(chatId, msg.message_id);
      return;
    }
    const { message, keyboard } = buildCollectionContent(userId, page, filter);
    const extra = { reply_markup: { inline_keyboard: keyboard } };
    const { waifu: displayWaifu } = getDisplayWaifu(userData);
    const imagePath = findCharacterImage(displayWaifu.name);
    let sentMessage, isPhoto = false;
    if (imagePath) {
      try { sentMessage = await safeReplyWithPhoto(ctx, { source: imagePath }, { caption: message, ...extra }); isPhoto = true; }
      catch { sentMessage = await safeReply(ctx, message, extra); }
    } else { sentMessage = await safeReply(ctx, message, extra); }
    collectionSessions[sentMessage.message_id] = { userId, isPhoto, filter, page };
    borrarMensajeDespues(chatId, sentMessage.message_id);
  }

  bot.command('coleccion', async (ctx) => { await enviarColeccion(ctx, ctx.from.id); });

  bot.command(['predeterminada', 'predeterminado', 'default'], async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const userData = loadUserData(userId);

    if (userData.waifus.length === 0) {
      const msg = await safeReply(ctx, toFancyText('❌ Aún no tienes waifus. Captura una primero.'));
      borrarMensajeDespues(chatId, msg.message_id, 60000);
      return;
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const nombre = args.join(' ').trim();

    if (!nombre) {
      if (userData.predeterminada) {
        const found = userData.waifus.find(w => w.name === userData.predeterminada);
        const emoji = found ? (rarityEmojis[found.rarity] || '❓') : '❓';
        const msg = await safeReply(ctx, fancyFormat`🎴 ᴛᴜ ᴘʀᴇᴅᴇᴛᴇʀᴍɪɴᴀᴅᴀ ᴀᴄᴛᴜᴀʟ

${emoji} ${toFancyText(userData.predeterminada)}

📌 Se muestra al abrir /coleccion en lugar de la última capturada.

✏️ Cambiar: /predeterminada <nombre>
🗑️ Quitar: /predeterminada quitar`);
        borrarMensajeDespues(chatId, msg.message_id, 90000);
      } else {
        const msg = await safeReply(ctx, fancyFormat`🎴 ᴘʀᴇᴅᴇᴛᴇʀᴍɪɴᴀᴅᴀ

No tienes una waifu predeterminada establecida.
Por defecto se muestra la última que capturaste.

📝 Uso:
/predeterminada <nombre>
Ejemplo: /predeterminada Asuka Langley

🗑️ Para quitarla:
/predeterminada quitar

✅ La waifu debe estar en tu colección.`);
        borrarMensajeDespues(chatId, msg.message_id, 90000);
      }
      return;
    }

    const lower = nombre.toLowerCase();
    if (lower === 'quitar' || lower === 'remove' || lower === 'clear' || lower === 'borrar' || lower === 'reset') {
      if (!userData.predeterminada) {
        const msg = await safeReply(ctx, toFancyText('⚠️ No tienes ninguna predeterminada establecida.'));
        borrarMensajeDespues(chatId, msg.message_id, 60000);
        return;
      }
      userData.predeterminada = null;
      saveUserData(userId, userData, ctx.from.first_name, ctx.from.username || null);
      const msg = await safeReply(ctx, toFancyText('✅ Predeterminada eliminada. Se mostrará la última waifu capturada.'));
      borrarMensajeDespues(chatId, msg.message_id, 60000);
      return;
    }

    const found = userData.waifus.find(w => w.name.toLowerCase() === lower);
    if (!found) {
      const msg = await safeReply(ctx, fancyFormat`❌ No tienes a ${toFancyText(nombre)} en tu colección.`);
      borrarMensajeDespues(chatId, msg.message_id, 60000);
      return;
    }

    userData.predeterminada = found.name;
    saveUserData(userId, userData, ctx.from.first_name, ctx.from.username || null);

    const emoji = rarityEmojis[found.rarity] || '❓';
    const serie = waifuSeries[found.name] || (found.exclusive ? 'Exclusiva de subasta' : 'Desconocida');
    const msg = await safeReply(ctx, fancyFormat`✅ ᴘʀᴇᴅᴇᴛᴇʀᴍɪɴᴀᴅᴀ ᴇꜱᴛᴀʙʟᴇᴄɪᴅᴀ

${emoji} ${toFancyText(found.name)}
📺 Origen: ${toFancyText(serie)}
✨ Rareza: ${toFancyText(found.rarity)}

🎴 Ahora aparecerá al abrir /coleccion.`);
    borrarMensajeDespues(chatId, msg.message_id, 90000);
  });

  bot.command('ranking', async (ctx) => {
    const chatId = ctx.chat.id;
    try {
      const files = fs.readdirSync(USERS_DIR);
      const users = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = parseInt(file.replace('.json', ''), 10);
          if (isNaN(userId)) continue;
          const stats = countOwnedWaifus(userId);
          if (stats.total > 0) {
            const data = loadUserData(userId);
            let display = data.username ? `@${data.username}` : (data.name || `Usuario ${userId}`);
            users.push({ userId, display, count: stats.total, unique: stats.unique });
          }
        }
      }
      users.sort((a, b) => b.count - a.count);
      const top10 = users.slice(0, 10);
      if (!top10.length) {
        const msg = await safeReply(ctx, toFancyText('📊 Aún no hay waifus capturadas. ¡Sé el primero!'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      const total = users.reduce((a, u) => a + u.count, 0);
      const msg = generarRanking(top10, total);
      const topUser = top10[0];
      let sentMessage;
      try {
        const photos = await bot.telegram.getUserProfilePhotos(topUser.userId, { limit: 1 });
        if (photos.total_count > 0) sentMessage = await safeReplyWithPhoto(ctx, photos.photos[0][0].file_id, { caption: msg });
        else sentMessage = await safeReply(ctx, msg);
      } catch { sentMessage = await safeReply(ctx, msg); }
      borrarMensajeDespues(chatId, sentMessage.message_id, 120000);
    } catch (e) { console.error(e); }
  });

  bot.command('rankingdiario', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const confirmMsg = await safeReply(ctx, toFancyText('📤 Enviando ranking diario...'));
    try {
      const files = fs.readdirSync(USERS_DIR);
      const users = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = parseInt(file.replace('.json', ''), 10);
          if (isNaN(userId)) continue;
          const stats = countOwnedWaifus(userId);
          if (stats.total > 0) {
            const data = loadUserData(userId);
            let display = data.username ? `@${data.username}` : (data.name || `Usuario ${userId}`);
            users.push({ userId, display, count: stats.total, unique: stats.unique });
          }
        }
      }
      users.sort((a, b) => b.count - a.count);
      const top10 = users.slice(0, 10);
      if (!top10.length) {
        await safeReply(ctx, toFancyText('⚠️ No hay waifus capturadas aún.'));
        return borrarMensajeDespues(chatId, confirmMsg.message_id);
      }
      const total = users.reduce((a, u) => a + u.count, 0);
      const msg = generarRanking(top10, total);

      const topUser = top10[0];
      let topPhotoFileId = null;
      try {
        const photos = await retryAsync(() => bot.telegram.getUserProfilePhotos(topUser.userId, { limit: 1 }), 2, 1500);
        if (photos.total_count > 0) { const sizes = photos.photos[0]; topPhotoFileId = sizes[sizes.length - 1].file_id; }
      } catch (e) { console.error('No se pudo obtener la foto del TOP 1:', e.message); }

      const chats = loadChatIds();
      let enviados = 0;
      for (const chat of chats) {
        try {
          const info = await bot.telegram.getChat(chat);
          if (info.type === 'private') continue;
          if (topPhotoFileId) {
            try { await safeSendPhoto(chat, topPhotoFileId, { caption: msg }); enviados++; }
            catch (photoErr) { await safeSendMessage(chat, msg); enviados++; }
          } else { await safeSendMessage(chat, msg); enviados++; }
        } catch {}
      }
      await safeReply(ctx, fancyFormat`✅ Ranking enviado a ${enviados} grupos.`);
      borrarMensajeDespues(chatId, confirmMsg.message_id);
    } catch (e) { console.error('Error:', e); }
  });

  bot.command(['total', 'disponibles'], async (ctx) => {
    const chatId = ctx.chat.id;
    let msg = toFancyText('📊 Waifus disponibles:\n\n');
    let total = 0;
    for (const r in waifuPool) {
      const c = waifuPool[r].characters.length;
      total += c;
      msg += fancyFormat`${rarityEmojis[r] || '❓'} ${toFancyText(r.charAt(0).toUpperCase() + r.slice(1))}: ${c}\n`;
    }
    const excls = listExclusiveNames();
    msg += fancyFormat`\n🌟 ${toFancyText('Exclusiva')}: ${excls.length} (solo subasta)\n`;
    msg += fancyFormat`\nTotal salvajes: ${total} waifus únicas`;
    msg += fancyFormat`\nTotal con exclusivas: ${total + excls.length}`;
    const m = await safeReply(ctx, msg);
    borrarMensajeDespues(chatId, m.message_id, 60000);
  });

  bot.command('permiso', async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const args = ctx.message.text.trim().split(' ');
    args.shift();
    if (args.length < 1) {
      const msg = await safeReply(ctx, fancyFormat`❌ Uso: ${"/permiso"} add (respondiendo a un mensaje) o ${"/permiso"} remove (respondiendo a un mensaje)`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const accion = args[0].toLowerCase();
    let targetId;
    const reply = ctx.message.reply_to_message;
    if (reply && reply.from) targetId = reply.from.id;
    else {
      if (args.length < 2) {
        const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un mensaje o dar un ID.'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      targetId = parseInt(args[1], 10);
      if (isNaN(targetId)) {
        const msg = await safeReply(ctx, toFancyText('❌ ID inválido.'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
    }
    let permisos = loadPermisos();
    if (accion === 'add') {
      if (permisos.includes(targetId)) {
        const msg = await safeReply(ctx, fancyFormat`⚠️ El usuario ${targetId} ya tiene permisos.`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      permisos.push(targetId);
      savePermisos(permisos);
      const msg = await safeReply(ctx, fancyFormat`✅ Usuario ${targetId} autorizado.`);
      borrarMensajeDespues(chatId, msg.message_id);
    } else if (accion === 'remove') {
      const i = permisos.indexOf(targetId);
      if (i === -1) {
        const msg = await safeReply(ctx, fancyFormat`⚠️ El usuario ${targetId} no está autorizado.`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      permisos.splice(i, 1);
      savePermisos(permisos);
      const msg = await safeReply(ctx, fancyFormat`❌ Usuario ${targetId} ya no tiene permisos.`);
      borrarMensajeDespues(chatId, msg.message_id);
    } else {
      const msg = await safeReply(ctx, toFancyText('❌ Acción inválida. Usa "add" o "remove".'));
      borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
  });

  bot.command('agregarw', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const args = ctx.message.text.trim().split(' ');
    args.shift();
    if (args.length < 2) {
      const msg = await safeReply(ctx, fancyFormat`❌ Uso: ${"/agregarw"} <nombre> <rareza> [origen]

Rarezas: comun, rara, epica, legendaria, exclusiva

🌟 Con "exclusiva" la waifu se guarda en
personajes/exclusivas/ y solo aparece en subastas.
NO entra al pool de capturas salvajes.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const valid = ['comun', 'rara', 'epica', 'legendaria', 'exclusiva'];
    let idx = -1;
    for (let i = 0; i < args.length; i++) if (valid.includes(args[i].toLowerCase())) { idx = i; break; }
    if (idx === -1) {
      const msg = await safeReply(ctx, fancyFormat`❌ Rareza debe ser: ${valid.join(', ')}`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const rareza = args[idx].toLowerCase();
    const nombre = args.slice(0, idx).join(' ').trim();
    const serie = args.slice(idx + 1).join(' ').trim() || 'Desconocida';
    if (!nombre) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes especificar un nombre.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    if (rareza === 'exclusiva') {
      if (findExclusiveWaifu(nombre)) {
        const msg = await safeReply(ctx, fancyFormat`❌ Ya existe la exclusiva "${toFancyText(nombre)}" en personajes/exclusivas/.`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      const reply = ctx.message.reply_to_message;
      if (!reply || !reply.photo) {
        const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un mensaje con imagen.'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      const photo = reply.photo[reply.photo.length - 1];
      try {
        const fileLink = await retryAsync(() => bot.telegram.getFile(photo.file_id), 3, 1500);
        const filePath = fileLink.file_path;
        const ext = (path.extname(filePath) || '.jpg').toLowerCase();
        const destPath = path.join(EXCLUSIVAS_DIR, nombre + ext);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
        const response = await fetchWithTimeout(fileUrl);
        if (!response.ok) throw new Error('Error descarga');
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(destPath, buffer);

        const msg = await safeReply(ctx, fancyFormat`🌟 ¡Waifu EXCLUSIVA agregada!

🎴 ${toFancyText(nombre)}
📺 Origen: ${toFancyText(serie)}
✨ Rareza: 🌟 ${toFancyText('exclusiva')}

📁 Guardada en: personajes/exclusivas/
⚠️ NO entra al pool de capturas salvajes.
💎 Aparecerá en la próxima subasta (solo 3 copias).`);
        borrarMensajeDespues(chatId, msg.message_id, 90000);
      } catch (e) {
        console.error('[Waifus] Error /agregarw exclusiva:', e);
        const msg = await safeReply(ctx, toFancyText('❌ Error al agregar la exclusiva.'));
        borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      return;
    }

    if (findWaifuByName(nombre)) {
      const msg = await safeReply(ctx, fancyFormat`❌ Ya existe "${toFancyText(nombre)}".`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    if (!waifuPool[rareza]) {
      const msg = await safeReply(ctx, toFancyText('❌ Rareza no válida en el pool.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.photo) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un mensaje con imagen.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const photo = reply.photo[reply.photo.length - 1];
    try {
      const fileLink = await retryAsync(() => bot.telegram.getFile(photo.file_id), 3, 1500);
      const filePath = fileLink.file_path;
      const ext = path.extname(filePath) || '.jpg';
      const destPath = path.join(CHARACTERS_DIR, nombre + ext);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await fetchWithTimeout(fileUrl);
      if (!response.ok) throw new Error('Error descarga');
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);
      waifuPool[rareza].characters.push(nombre);
      waifuSeries[nombre] = serie;
      saveWaifuData();
      const msg = await safeReply(ctx, fancyFormat`✅ ¡Waifu "${toFancyText(nombre)}" agregada!
📺 Origen: ${toFancyText(serie)}
✨ Rareza: ${rarityEmojis[rareza]} ${toFancyText(rareza)}`);
      borrarMensajeDespues(chatId, msg.message_id);
    } catch (e) {
      console.error(e);
      const msg = await safeReply(ctx, toFancyText('❌ Error al agregar.'));
      borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
  });

  bot.command('eliminarw', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const nombre = args.join(' ').trim();

    if (!nombre) {
      const msg = await safeReply(ctx, fancyFormat`❌ Uso: ${"/eliminarw"} <nombre>

Ejemplo: /eliminarw Asuka Langley
Ejemplo: /eliminarw Akame

Elimina la waifu del sistema (pool, serie e imagen).
También funciona con exclusivas.
Esta acción no se puede deshacer.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const found = findWaifuByName(nombre);
    const excl = findExclusiveWaifu(nombre);

    if (!found && !excl) {
      const msg = await safeReply(ctx, fancyFormat`❌ No existe ninguna waifu llamada "${toFancyText(nombre)}".`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    if (!found && excl) {
      try {
        fs.unlinkSync(excl.file);
      } catch (e) {
        const msg = await safeReply(ctx, fancyFormat`⚠️ No se pudo borrar el archivo de la exclusiva: ${e.message}`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }

      const cleanup = cleanupOrphanedWaifus({
        specificName: excl.name,
        force: true
      });

      let extra = '';
      if (cleanup.totalRemoved > 0) {
        extra = fancyFormat`\n\n🧹 ᴘᴇʀꜰɪʟᴇꜱ ʟɪᴍᴘɪᴀᴅᴏꜱ: ${cleanup.usersAffected} usuarios (${cleanup.totalRemoved} copias eliminadas)`;
      } else if (cleanup.usersSkipped > 0) {
        extra = fancyFormat`\n\n⚠️ ${cleanup.usersSkipped} perfiles omitidos por seguridad`;
      }

      const msg = await safeReply(ctx, fancyFormat`✅ ᴇxᴄʟᴜꜱɪᴠᴀ ᴇʟɪᴍɪɴᴀᴅᴀ

🌟 ${toFancyText(excl.name)}
📁 Archivo: ${path.basename(excl.file)}${extra}`);
      return borrarMensajeDespues(chatId, msg.message_id, 60000);
    }

    let eliminadaDelPool = false;
    try {
      const list = waifuPool[found.rarity]?.characters;
      if (Array.isArray(list)) {
        const idx = list.findIndex(c => String(c).toLowerCase() === found.name.toLowerCase());
        if (idx !== -1) { list.splice(idx, 1); eliminadaDelPool = true; }
      }
    } catch (e) { console.error('[Waifus] Error quitando del pool:', e.message); }

    let eliminadaDeSeries = false;
    try {
      if (Object.prototype.hasOwnProperty.call(waifuSeries, found.name)) { delete waifuSeries[found.name]; eliminadaDeSeries = true; }
    } catch (e) { console.error('[Waifus] Error quitando de series:', e.message); }

    let guardadoOk = true;
    try { if (!saveWaifuData()) guardadoOk = false; } catch (e) { console.error('[Waifus] Error guardando waifu_data:', e.message); guardadoOk = false; }

    const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const imagenesBorradas = [];
    for (const ext of exts) {
      const fp = path.join(CHARACTERS_DIR, found.name + ext);
      try {
        if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { fs.unlinkSync(fp); imagenesBorradas.push(path.basename(fp)); }
      } catch (e) { console.error(`[Waifus] No se pudo borrar ${fp}:`, e.message); }
    }

    if (!eliminadaDelPool && !eliminadaDeSeries) {
      const msg = await safeReply(ctx, fancyFormat`⚠️ Se encontró "${toFancyText(found.name)}" pero no se pudo eliminar de la base de datos.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const emoji = rarityEmojis[found.rarity] || '❓';
    let resumen = fancyFormat`✅ ᴡᴀɪꜰᴜ ᴇʟɪᴍɪɴᴀᴅᴀ

${emoji} ${toFancyText(found.name)}
✨ ʀᴀʀᴇᴢᴀ: ${toFancyText(found.rarity)}

📦 ᴘᴏᴏʟ: ${eliminadaDelPool ? '✅ ʀᴇᴍᴏᴠɪᴅᴀ' : '⚠️ ɴᴏ ᴇꜱᴛᴀʙᴀ'}
📺 ꜱᴇʀɪᴇ: ${eliminadaDeSeries ? '✅ ʀᴇᴍᴏᴠɪᴅᴀ' : '⚠️ ɴᴏ ᴇꜱᴛᴀʙᴀ'}
💾 ɢᴜᴀʀᴅᴀᴅᴏ: ${guardadoOk ? '✅' : '❌'}`;

    if (imagenesBorradas.length > 0) resumen += fancyFormat`\n🖼️ ɪᴍáɢᴇɴᴇꜱ ʙᴏʀʀᴀᴅᴀꜱ: ${imagenesBorradas.join(', ')}`;
    else resumen += fancyFormat`\n🖼️ ɪᴍáɢᴇɴ: ⚠️ ɴᴏ ᴇɴᴄᴏɴᴛʀᴀᴅᴀ`;

    const cleanup = cleanupOrphanedWaifus({
      specificName: found.name,
      force: true
    });

    if (cleanup.totalRemoved > 0) {
      resumen += fancyFormat`\n\n🧹 ᴘᴇʀꜰɪʟᴇꜱ ʟɪᴍᴘɪᴀᴅᴏꜱ: ${cleanup.usersAffected} usuarios (${cleanup.totalRemoved} copias eliminadas)`;
      console.log(`[Waifus] 🧹 Limpieza tras /eliminarw "${found.name}": ${cleanup.usersAffected} perfiles, ${cleanup.totalRemoved} copias.`);
    } else if (cleanup.usersSkipped > 0) {
      resumen += fancyFormat`\n\n⚠️ ${cleanup.usersSkipped} perfiles omitidos por seguridad`;
    }

    const msg = await safeReply(ctx, resumen);
    borrarMensajeDespues(chatId, msg.message_id, 60000);
  });

  bot.command('reemplazarw', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const nombre = args.join(' ').trim();

    if (!nombre) {
      const msg = await safeReply(ctx, fancyFormat`❌ Uso: ${"/reemplazarw"} <nombre>

Debes responder a un mensaje con imagen.

Ejemplo: responde a la nueva imagen y escribe:
/reemplazarw Asuka Langley

🖼️ Reemplaza la foto de perfil de una waifu existente sin tocar su rareza, origen ni las colecciones de los usuarios.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const reply = ctx.message.reply_to_message;
    if (!reply || !reply.photo) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un mensaje que contenga una imagen.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const found = findWaifuByName(nombre);
    if (!found) {
      const msg = await safeReply(ctx, fancyFormat`❌ No existe ninguna waifu llamada "${toFancyText(nombre)}".

Usa /agregarw para crearla primero.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const photo = reply.photo[reply.photo.length - 1];

    try {
      const fileLink = await retryAsync(() => bot.telegram.getFile(photo.file_id), 3, 1500);
      const filePath = fileLink.file_path;
      const ext = (path.extname(filePath) || '.jpg').toLowerCase();

      const exts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const imagenesBorradas = [];
      for (const e of exts) {
        const fp = path.join(CHARACTERS_DIR, found.name + e);
        try {
          if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { fs.unlinkSync(fp); imagenesBorradas.push(path.basename(fp)); }
        } catch (err) { console.error(`[Waifus] No se pudo borrar ${fp}:`, err.message); }
      }

      const destPath = path.join(CHARACTERS_DIR, found.name + ext);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await fetchWithTimeout(fileUrl);
      if (!response.ok) throw new Error('Error descargando la imagen desde Telegram');
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);

      const emoji = rarityEmojis[found.rarity] || '❓';
      let resumen = fancyFormat`✅ ꜰᴏᴛᴏ ᴀᴄᴛᴜᴀʟɪᴢᴀᴅᴀ

${emoji} ${toFancyText(found.name)}
✨ ʀᴀʀᴇᴢᴀ: ${toFancyText(found.rarity)} (ꜱɪɴ ᴄᴀᴍʙɪᴏꜱ)
📺 ꜱᴇʀɪᴇ: ${toFancyText(waifuSeries[found.name] || 'Desconocida')}

🖼️ ɴᴜᴇᴠᴀ ɪᴍáɢᴇɴ: ${path.basename(destPath)}`;

      if (imagenesBorradas.length > 0) resumen += fancyFormat`\n🗑️ ᴀɴᴛɪɢᴜᴀꜱ ʙᴏʀʀᴀᴅᴀꜱ: ${imagenesBorradas.join(', ')}`;
      else resumen += fancyFormat`\n🗑️ ᴀɴᴛɪɢᴜᴀꜱ: ⚠️ ɴᴏ ʜᴀʙíᴀ ɴɪɴɢᴜɴᴀ`;

      const msg = await safeReply(ctx, resumen);
      borrarMensajeDespues(chatId, msg.message_id, 60000);
    } catch (e) {
      console.error('[Waifus] Error en /reemplazarw:', e);
      const msg = await safeReply(ctx, toFancyText('❌ Error al reemplazar la imagen. Intenta de nuevo.'));
      borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
  });

  // ============================================================
  // 🎨 COMANDO: /agregarportada
  // ============================================================
  bot.command(['agregarportada', 'addcover'], async (ctx) => {
    const chatId = ctx.chat.id;

    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const nombre = args.join(' ').trim();

    if (!nombre) {
      const msg = await safeReply(ctx, fancyFormat`🎨 ᴜꜱᴏ ɪɴᴄᴏʀʀᴇᴄᴛᴏ

📝 Responde a un VIDEO, GIF o animación y escribe:
/agregarportada <nombre>

📌 Ejemplo:
(responde al video)
/agregarportada Asuka Langley

✅ La waifu debe existir (usa /agregarw primero).
💰 Precio en tienda: ${SHOP_PRICE} monedas.
🎨 Aparece en /tienda → Portadas animadas.
🗑️ Reemplaza la portada anterior si ya existía.

💡 La portada se vincula por NOMBRE (debe coincidir con la waifu).`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const reply = ctx.message.reply_to_message;
    if (!reply) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un mensaje que contenga un VIDEO, GIF o animación.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    let media = null;
    let extHint = null;

    if (reply.animation) {
      media = reply.animation;
      const mt = String(media.mime_type || '').toLowerCase();
      if (mt.includes('gif')) extHint = '.gif';
      else if (mt.includes('webm')) extHint = '.webm';
      else extHint = (path.extname(media.file_name || '') || '.mp4').toLowerCase();
    } else if (reply.video) {
      media = reply.video;
      extHint = (path.extname(media.file_name || '') || '.mp4').toLowerCase();
    } else if (reply.document && /video|gif|webm/i.test(reply.document.mime_type || '')) {
      media = reply.document;
      extHint = (path.extname(media.file_name || '') || '.mp4').toLowerCase();
    }

    if (!media) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes responder a un VIDEO, GIF o animación.\n\nFormatos soportados: MP4, GIF, WEBM.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const found = findWaifuByName(nombre);
    const excl = !found ? findExclusiveWaifu(nombre) : null;

    if (!found && !excl) {
      const msg = await safeReply(ctx, fancyFormat`❌ No existe ninguna waifu llamada "${toFancyText(nombre)}".

💡 Usa /agregarw para crearla primero.
📌 También puedes usar el nombre de una EXCLUSIVA.`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const finalName = found ? found.name : excl.name;
    const finalRarity = found ? found.rarity : 'exclusiva';

    try {
      const statusMsg = await safeReply(ctx, fancyFormat`📥 ᴅᴇꜱᴄᴀʀɢᴀɴᴅᴏ ᴘᴏʀᴛᴀᴅᴀ ᴀɴɪᴍᴀᴅᴀ...

🎴 ${toFancyText(finalName)}`);

      const fileLink = await retryAsync(() => bot.telegram.getFile(media.file_id), 3, 1500);
      const filePath = fileLink.file_path;
      const realExt = (path.extname(filePath) || extHint || '.mp4').toLowerCase();

      const exts = ['.gif', '.mp4', '.png', '.jpg', '.jpeg', '.webp', '.webm'];
      const borradas = [];
      for (const e of exts) {
        const fp = path.join(GIFS_DIR, finalName + e);
        try {
          if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
            fs.unlinkSync(fp);
            borradas.push(path.basename(fp));
          }
        } catch (err) { console.error(`[Waifus] No se pudo borrar portada ${fp}:`, err.message); }
      }

      const destPath = path.join(GIFS_DIR, finalName + realExt);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const response = await fetchWithTimeout(fileUrl);
      if (!response.ok) throw new Error('Error descargando el archivo desde Telegram');
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(destPath, buffer);

      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

      if (statusMsg && statusMsg.message_id) {
        try { await bot.telegram.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}
      }

      let resumen = fancyFormat`✅ ᴘᴏʀᴛᴀᴅᴀ ᴀɴɪᴍᴀᴅᴀ ᴀɢʀᴇɢᴀᴅᴀ

🎴 ${toFancyText(finalName)}
${rarityEmojis[finalRarity] || '❓'} ʀᴀʀᴇᴢᴀ: ${toFancyText(finalRarity)}
🎨 ᴀʀᴄʜɪᴠᴏ: ${path.basename(destPath)}
📦 ᴛᴀᴍᴀñᴏ: ${sizeMB} MB

💰 ᴘʀᴇᴄɪᴏ ᴇɴ ᴛɪᴇɴᴅᴀ: ${SHOP_PRICE} ᴍᴏɴᴇᴅᴀꜱ
📌 ᴀᴘᴀʀᴇᴄᴇʀá ᴇɴ /tienda → ᴘᴏʀᴛᴀᴅᴀꜱ ᴀɴɪᴍᴀᴅᴀꜱ
👁️ sᴇ ᴍᴏꜱᴛʀᴀʀá ᴀʟ ᴜꜱᴀʀ /ver (ꜱɪ ᴇʟ ᴜꜱᴜᴀʀɪᴏ ʟᴀ ᴄᴏᴍᴘʀó)`;

      if (borradas.length > 0) resumen += fancyFormat`\n\n🗑️ ᴀɴᴛᴇʀɪᴏʀᴇꜱ ʀᴇᴇᴍᴘʟᴀᴢᴀᴅᴀꜱ: ${borradas.join(', ')}`;

      const msg = await safeReply(ctx, resumen);
      borrarMensajeDespues(chatId, msg.message_id, 90000);
    } catch (e) {
      console.error('[Waifus] Error en /agregarportada:', e);
      const msg = await safeReply(ctx, fancyFormat`❌ Error al agregar la portada.

📌 Detalle: ${e.message}

💡 Verifica que:
• El archivo no sea demasiado grande (máx 20 MB).
• El bot tenga acceso al archivo.
• Respondiste a un VIDEO/GIF válido.`);
      borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
  });

  bot.command('prueba', async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }
    const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
    let waifu;
    if (args) {
      const found = findWaifuByName(args);
      if (!found) {
        const msg = await safeReply(ctx, fancyFormat`❌ No encontré "${toFancyText(args)}".`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      waifu = found;
    } else waifu = getRandomWaifuWithHistory(chatId);
    updateChatHistory(chatId, waifu.name);
    const emoji = rarityEmojis[waifu.rarity];
    const serie = waifuSeries[waifu.name] || 'Desconocida';
    const text = fancyFormat`🧪 [PRUEBA] Waifu salvaje.

${emoji} Rareza: ${toFancyText(waifu.rarity)}
📺 Origen: ${toFancyText(serie)}

⏳ ${CAPTURE_TIME_MIN} minutos para capturarla.
🔹 Modo prueba - no se guardará.

¿Cuál es su nombre?`;
    sendWaifuWithTimer(chatId, waifu, text, true);
  });

  bot.command(['recargarmonedas', 'recalculareconomia'], async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = ctx.message.text.trim().split(' ').slice(1);
    const modo = (args[0] || 'add').toLowerCase();
    if (modo !== 'add' && modo !== 'set') {
      const msg = await safeReply(ctx, fancyFormat`❌ Modo inválido. Usa:
/recargarmonedas add  → suma las monedas
/recargarmonedas set  → establece el saldo exacto`);
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const statusMsg = await safeReply(ctx, toFancyText('💰 Calculando monedas retroactivas...'));

    try {
      const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
      let usuariosAfectados = 0;
      let usuariosSinWaifus = 0;
      let totalMonedas = 0;
      let totalWaifus = 0;
      let detalle = '';

      for (const file of files) {
        const userId = parseInt(file.replace('.json', ''), 10);
        if (isNaN(userId)) continue;
        const data = loadUserData(userId);
        if (!data.waifus || data.waifus.length === 0) { usuariosSinWaifus++; continue; }
        let earned = 0;
        for (const w of data.waifus) earned += COINS_REWARD[w.rarity] || 0;
        const antes = data.coins || 0;
        if (modo === 'add') data.coins = antes + earned;
        else data.coins = earned;
        try { atomicWriteFileSync(getUserDataFile(userId), JSON.stringify(data, null, 2)); } catch (_) {}
        usuariosAfectados++;
        totalMonedas += earned;
        totalWaifus += data.waifus.length;
        if (usuariosAfectados <= 5) {
          const nombre = data.username ? `@${data.username}` : (data.name || `Usuario ${userId}`);
          detalle += `┣ ${nombre} → +${earned} 🪙 (${antes} → ${data.coins})\n`;
        }
      }

      let resumen = fancyFormat`✅ ʀᴇᴄᴀʀɢᴀ ᴄᴏᴍᴘʟᴇᴛᴀᴅᴀ

🔧 ᴍᴏᴅᴏ: ${modo === 'add' ? 'SUMAR' : 'ESTABLECER'}
👥 ᴜꜱᴜᴀʀɪᴏꜱ ᴀꜰᴇᴄᴛᴀᴅᴏꜱ: ${usuariosAfectados}
🍥 ᴡᴀɪғᴜꜱ ᴛᴏᴛᴀʟᴇꜱ ᴄᴏɴᴛᴀʙɪʟɪᴢᴀᴅᴀꜱ: ${totalWaifus}
🪙 ᴍᴏɴᴇᴅᴀꜱ ᴛᴏᴛᴀʟᴇꜱ: ${totalMonedas}`;

      if (detalle) resumen += `\n\n📋 ᴘʀɪᴍᴇʀᴏꜱ 5 ᴜꜱᴜᴀʀɪᴏꜱ:\n${detalle}`;
      if (usuariosSinWaifus > 0) resumen += `\n\nℹ️ ${usuariosSinWaifus} usuarios sin waifus (omitidos).`;
      await safeReply(ctx, resumen);
    } catch (e) {
      console.error('Error recargando monedas:', e);
      await safeReply(ctx, toFancyText('❌ Error al recargar monedas.'));
    }
    borrarMensajeDespues(chatId, statusMsg.message_id, 5000);
  });

  // ==================== 🎁 ADMIN: REGALAR WAIFU ====================
  bot.command(['adminwaifu', 'givewaifu', 'aw', 'adminregalarw'], async (ctx) => {
    const chatId = ctx.chat.id;

    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const reply = ctx.message.reply_to_message;

    let targetId = null;
    let resto = [];

    if (reply && reply.from && !reply.from.is_bot) {
      targetId = reply.from.id;
      resto = args;
    } else {
      if (args.length < 2) {
        const msg = await safeReply(ctx, fancyFormat`❌ ᴜꜱᴏ ɪɴᴄᴏʀʀᴇᴄᴛᴏ

📝 Respondiendo a un mensaje:
/adminwaifu <nombre> [rareza]

📝 Sin responder:
/adminwaifu <userId> <nombre> [rareza]

📌 Ejemplos:
/adminwaifu 123456789 Asuka Langley
/adminwaifu 123456789 Akame exclusiva
/adminwaifu Kanna Kamui legendaria (respondiendo)

🎨 Rarezas opcionales: comun, rara, epica, legendaria, exclusiva
💡 Si no se especifica, se detecta automáticamente.`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      targetId = parseInt(args[0], 10);
      if (isNaN(targetId)) {
        const msg = await safeReply(ctx, toFancyText('❌ ID de usuario inválido.'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      resto = args.slice(1);
    }

    if (!resto.length) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes especificar el nombre de la waifu.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const validRarities = ['comun', 'rara', 'epica', 'legendaria', 'exclusiva'];
    let rareza = null;
    const lastArg = String(resto[resto.length - 1]).toLowerCase();
    if (validRarities.includes(lastArg)) {
      rareza = lastArg;
      resto = resto.slice(0, -1);
    }

    const nombreInput = resto.join(' ').trim();
    if (!nombreInput) {
      const msg = await safeReply(ctx, toFancyText('❌ Debes especificar un nombre.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    let finalRarity = rareza;
    let finalName = nombreInput;

    const found = findWaifuByName(nombreInput);
    const excl = !found ? findExclusiveWaifu(nombreInput) : null;

    if (found) {
      finalName = found.name;
      if (!finalRarity) finalRarity = found.rarity;
    } else if (excl) {
      finalName = excl.name;
      if (!finalRarity) finalRarity = 'exclusiva';
    } else if (!finalRarity) {
      finalRarity = 'comun';
    }

    const targetData = loadUserData(targetId);
    targetData.waifus.push({
      name: finalName,
      rarity: finalRarity,
      timestamp: Date.now(),
      giftedBy: ctx.from.id
    });

    const ok = saveUserData(targetId, targetData);
    if (!ok) {
      const msg = await safeReply(ctx, toFancyText('❌ No se pudo guardar la waifu.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const emoji = rarityEmojis[finalRarity] || '❓';
    const stats = countOwnedWaifus(targetId);

    const msg = await safeReply(ctx, fancyFormat`🎁 ᴡᴀɪғᴜ ʀᴇɢᴀʟᴀᴅᴀ ᴘᴏʀ ᴀᴅᴍɪɴ

👤 ᴅᴇꜱᴛɪɴᴀᴛᴀʀɪᴏ: ${targetId}
${emoji} ${toFancyText(finalName)}
✨ ʀᴀʀᴇᴢᴀ: ${toFancyText(finalRarity)}

📦 ᴛᴏᴛᴀʟ ᴅᴇʟ ᴜꜱᴜᴀʀɪᴏ: ${stats.total} (${stats.unique} únicas)`);
    borrarMensajeDespues(chatId, msg.message_id, 60000);

    try {
      const dm = await bot.telegram.sendMessage(targetId, fancyFormat`🎁 ¡ʜᴀꜱ ʀᴇᴄɪʙɪᴅᴏ ᴜɴᴀ ᴡᴀɪғᴜ ᴅᴇ ʀᴇɢᴀʟᴏ!

${emoji} ${toFancyText(finalName)}
✨ ʀᴀʀᴇᴢᴀ: ${toFancyText(finalRarity)}

📦 ᴛᴏᴛᴀʟ ᴀᴄᴛᴜᴀʟ: ${stats.total} (${stats.unique} únicas)`);
      if (dm && dm.chat?.id) borrarMensajeDespues(dm.chat.id, dm.message_id);
    } catch (_) {}
  });

  // ==================== 💰 ADMIN: REGALAR / QUITAR MONEDAS ====================
  bot.command(['admincoins', 'givecoins', 'ac', 'adminmonedas', 'regalarcoinsadmin'], async (ctx) => {
    const chatId = ctx.chat.id;

    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();
    const reply = ctx.message.reply_to_message;

    let targetId = null;
    let cantidadStr = null;

    if (reply && reply.from && !reply.from.is_bot) {
      targetId = reply.from.id;
      cantidadStr = args[0];
    } else {
      if (args.length < 2) {
        const msg = await safeReply(ctx, fancyFormat`❌ ᴜꜱᴏ ɪɴᴄᴏʀʀᴇᴄᴛᴏ

📝 Respondiendo a un mensaje:
/admincoins <cantidad>

📝 Sin responder:
/admincoins <userId> <cantidad>

📌 Ejemplos:
/admincoins 123456789 500
/admincoins -200 (respondiendo)

💡 Cantidad negativa = quitar monedas.
💡 El saldo nunca queda en negativo (mínimo 0).
📊 Máximo por operación: ±1,000,000`);
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
      targetId = parseInt(args[0], 10);
      cantidadStr = args[1];
      if (isNaN(targetId)) {
        const msg = await safeReply(ctx, toFancyText('❌ ID de usuario inválido.'));
        return borrarMensajeDespues(chatId, msg.message_id, 30000);
      }
    }

    const cantidad = parseInt(cantidadStr, 10);
    if (isNaN(cantidad) || cantidad === 0) {
      const msg = await safeReply(ctx, toFancyText('❌ Cantidad inválida (debe ser un número distinto de 0).'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    if (Math.abs(cantidad) > 1000000) {
      const msg = await safeReply(ctx, toFancyText('❌ Máximo ±1,000,000 por operación.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const targetData = loadUserData(targetId);
    const antes = targetData.coins || 0;
    const despues = Math.max(0, antes + cantidad);
    targetData.coins = despues;

    const ok = saveUserData(targetId, targetData);
    if (!ok) {
      const msg = await safeReply(ctx, toFancyText('❌ No se pudo guardar el saldo.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const signo = cantidad >= 0 ? '+' : '';
    const emojiOp = cantidad >= 0 ? '🎁' : '➖';

    const msg = await safeReply(ctx, fancyFormat`${emojiOp} ᴍᴏɴᴇᴅᴀꜱ ᴀᴊᴜꜱᴛᴀᴅᴀꜱ ᴘᴏʀ ᴀᴅᴍɪɴ

👤 ᴜꜱᴜᴀʀɪᴏ: ${targetId}
🪙 ᴀɴᴛᴇꜱ: ${antes}
📊 ᴄᴀᴍʙɪᴏ: ${signo}${cantidad}
✅ ᴀʜᴏʀᴀ: ${despues}`);
    borrarMensajeDespues(chatId, msg.message_id, 60000);

    if (cantidad > 0) {
      try {
        const dm = await bot.telegram.sendMessage(targetId, fancyFormat`💰 ¡ʜᴀꜱ ʀᴇᴄɪʙɪᴅᴏ ᴍᴏɴᴇᴅᴀꜱ ᴅᴇ ʀᴇɢᴀʟᴏ!

📊 ᴄᴀᴍʙɪᴏ: +${cantidad} 🪙
✅ ᴛᴏᴛᴀʟ ᴀᴄᴛᴜᴀʟ: ${despues} 🪙`);
        if (dm && dm.chat?.id) borrarMensajeDespues(dm.chat.id, dm.message_id);
      } catch (_) {}
    }
  });

  // ==================== 📋 ADMIN: VER CHATS REGISTRADOS ====================
  bot.command('chatsregistrados', async (ctx) => {
    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(ctx.chat.id, msg.message_id, 30000);
    }
    const chats = loadChatIds();
    const lineas = [];
    for (const id of chats.slice(0, 30)) {
      try {
        const info = await bot.telegram.getChat(id);
        lineas.push(`• ${id} — ${info.title || info.type}`);
      } catch { lineas.push(`• ${id} — ⚠️ sin acceso`); }
    }
    const msg = await safeReply(ctx,
      fancyFormat`📋 ᴄʜᴀᴛꜱ ʀᴇɢɪꜱᴛʀᴀᴅᴏꜱ: ${chats.length}\n\n${lineas.join('\n') || '(ninguno)'}`
    );
    borrarMensajeDespues(ctx.chat.id, msg.message_id, 90000);
  });

  // ============================================================
  // 🧹 ADMIN: LIMPIAR PERFILES (con dry-run obligatorio)
  // ============================================================
  bot.command(['limpiarperfiles', 'cleanprofiles'], async (ctx) => {
    const chatId = ctx.chat.id;

    if (!isAuthorized(ctx.from.id)) {
      const msg = await safeReply(ctx, toFancyText('❌ No tienes permiso.'));
      return borrarMensajeDespues(chatId, msg.message_id, 30000);
    }

    const args = (ctx.message.text || '').trim().split(/\s+/);
    args.shift();

    const confirmIdx = args.findIndex(a => a.toLowerCase() === 'confirmar' || a.toLowerCase() === 'confirm');
    const isConfirm = confirmIdx !== -1;

    let specificName = null;
    if (isConfirm) {
      args.splice(confirmIdx, 1);
      if (args.length > 0) specificName = args.join(' ').trim() || null;
    } else {
      if (args.length > 0) specificName = args.join(' ').trim() || null;
    }

    const statusMsg = await safeReply(ctx,
      toFancyText(isConfirm ? '🧹 Ejecutando limpieza...' : '🔍 Analizando perfiles (dry-run)...')
    );

    const result = cleanupOrphanedWaifus({
      specificName,
      dryRun: !isConfirm,
      force: false
    });

    try { await bot.telegram.deleteMessage(chatId, statusMsg.message_id); } catch (_) {}

    if (result.aborted) {
      const msg = await safeReply(ctx, fancyFormat`🛡️ ʟɪᴍᴘɪᴇᴢᴀ ᴀʙᴏʀᴛᴀᴅᴀ

❗ ᴍᴏᴛɪᴠᴏ: ${result.abortReason || 'desconocido'}

💡 El sistema se protegió automáticamente para evitar borrados masivos.
🔧 Si crees que es un error, revisa manualmente data/waifu_data.json y personajes/exclusivas/.`);
      borrarMensajeDespues(chatId, msg.message_id, 90000);
      return;
    }

    let text = '';

    if (result.dryRun) {
      text = fancyFormat`🔍 ᴅʀʏ-ʀᴜɴ (ɴᴀᴅᴀ ꜱᴇ ᴍᴏᴅɪꜰɪᴄᴀʀÁ)

🎯 ᴍᴏᴅᴏ: ${specificName ? `específico "${specificName}"` : 'global'}
👥 ᴘᴇʀꜰɪʟᴇꜱ ᴀꜰᴇᴄᴛᴀᴅᴏꜱ: ${result.usersAffected}
🗑️ ᴡᴀɪғᴜꜱ ᴀ ᴇʟɪᴍɪɴᴀʀ: ${result.totalRemoved}`;

      if (result.usersSkipped > 0) {
        text += fancyFormat`\n⚠️ ᴘᴇʀꜰɪʟᴇꜱ ᴏᴍɪᴛɪᴅᴏꜱ ᴘᴏʀ ꜱᴇɢᴜʀɪᴅᴀᴅ: ${result.usersSkipped}`;
      }

      if (result.removedNames.size > 0) {
        const nombres = [...result.removedNames].slice(0, 20).join(', ');
        text += fancyFormat`\n\n📋 ɴᴏᴍʙʀᴇꜱ ᴅᴇᴛᴇᴄᴛᴀᴅᴏꜱ:\n${nombres}`;
        if (result.removedNames.size > 20) {
          text += fancyFormat`\n... y ${result.removedNames.size - 20} más`;
        }
      } else {
        text += `\n\n✨ Todo limpio, no hay nada que eliminar.`;
        const msg = await safeReply(ctx, text);
        borrarMensajeDespues(chatId, msg.message_id, 90000);
        return;
      }

      text += fancyFormat`

━━━━━━━━━━━━━━━━━━━━
⚠️ ᴘᴀʀᴀ ᴇᴊᴇᴄᴜᴛᴀʀ ʟᴀ ʟɪᴍᴘɪᴇᴢᴀ:
${specificName ? `/limpiarperfiles confirmar ${specificName}` : '/limpiarperfiles confirmar'}

💾 Se creará un backup .bak-cleanup-* por cada perfil modificado.`;

      const msg = await safeReply(ctx, text);
      borrarMensajeDespues(chatId, msg.message_id, 180000);
      return;
    }

    text = fancyFormat`✅ ʟɪᴍᴘɪᴇᴢᴀ ᴄᴏᴍᴘʟᴇᴛᴀᴅᴀ

🎯 ᴍᴏᴅᴏ: ${specificName ? `específico "${specificName}"` : 'global'}
👥 ᴘᴇʀꜰɪʟᴇꜱ ᴀᴄᴛᴜᴀʟɪᴢᴀᴅᴏꜱ: ${result.usersAffected}
🗑️ ᴡᴀɪғᴜꜱ ᴇʟɪᴍɪɴᴀᴅᴀꜱ: ${result.totalRemoved}`;

    if (result.usersSkipped > 0) {
      text += fancyFormat`\n⚠️ ᴘᴇʀꜰɪʟᴇꜱ ᴏᴍɪᴛɪᴅᴏꜱ: ${result.usersSkipped}`;
    }

    if (result.removedNames.size > 0) {
      const nombres = [...result.removedNames].slice(0, 15).join(', ');
      text += fancyFormat`\n\n📋 ɴᴏᴍʙʀᴇꜱ ᴇʟɪᴍɪɴᴀᴅᴏꜱ:\n${nombres}`;
      if (result.removedNames.size > 15) {
        text += fancyFormat`\n... y ${result.removedNames.size - 15} más`;
      }
    }

    text += fancyFormat`\n\n💾 ʙᴀᴄᴋᴜᴘꜱ: cada perfil modificado tiene su .bak-cleanup-*`;

    console.log(`[Waifus] 🧹 Limpieza manual: ${result.usersAffected} perfiles, ${result.totalRemoved} waifus eliminadas.`);
    if (result.usersSkipped > 0) console.log(`[Waifus] 🧹 Perfiles omitidos por seguridad: ${result.usersSkipped}`);

    const msg = await safeReply(ctx, text);
    borrarMensajeDespues(chatId, msg.message_id, 120000);
  });

  // ==================== 👋 NUEVOS MIEMBROS ====================
  bot.on(['new_chat_members', 'my_chat_member'], async (ctx) => {
    try {
      const me = await bot.telegram.getMe();

      if (ctx.message?.new_chat_members) {
        const added = ctx.message.new_chat_members.some(m => m.id === me.id);
        if (added && ctx.chat.type !== 'private') {
          saveChatId(ctx.chat.id);
          await enviarBienvenidaUnaVez(ctx, ctx.chat.id, ctx.from?.first_name || 'amigo/a', false);
        }
        return;
      }

      if (ctx.myChatMember) {
        const { chat, new_chat_member } = ctx.myChatMember;
        const status = new_chat_member?.status;
        if (status === 'member' || status === 'administrator') {
          if (chat.type !== 'private') {
            saveChatId(chat.id);
            await enviarBienvenidaUnaVez(ctx, chat.id, ctx.from?.first_name || 'amigo/a', false);
          }
        } else if (status === 'left' || status === 'kicked') {
          removeChatId(chat.id);
          console.log(`[Waifus] 🗑️ Bot salió/expulsado de ${chat.id}`);
        }
      }
    } catch (e) {
      console.error('[Waifus] new_chat_members/my_chat_member:', e.message);
    }
  });

  // ============================================================
  // CALLBACK DE CAPTURA
  // ============================================================
  bot.action(/waifu_option_([a-f0-9]+)_(\d+)/, (ctx) => {
    const sessionId = ctx.match[1];
    const userId = ctx.from.id;
    const pending = pendingWaifus[sessionId];

    if (!pending) {
      const chatId = ctx.callbackQuery?.message?.chat?.id;
      const msgId = ctx.callbackQuery?.message?.message_id;
      if (chatId && msgId) {
        bot.telegram.deleteMessage(chatId, msgId).catch(() => {});
      }
      return safeAnswerCb(ctx, '⏰ Esta waifu ya no está disponible.', { show_alert: true });
    }

    if (Date.now() > pending.expiresAt) {
      safeAnswerCb(ctx, '¡Tarde! Escapó.');
      clearTimeout(pending.timer);
      delete pendingWaifus[sessionId];
      persistPending();
      return;
    }

    if (pending.attemptedUsers.includes(userId)) {
      return safeAnswerCb(ctx, '❌ Ya intentaste.', { show_alert: true });
    }

    const idx = parseInt(ctx.match[2], 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.botones.length) {
      return safeAnswerCb(ctx, '❌ Opción inválida.', { show_alert: true });
    }

    const selectedOriginal = pending.botones[idx];
    pending.attemptedUsers.push(userId);

    if (selectedOriginal !== pending.correctName) {
      persistPending();
      return safeAnswerCb(ctx, '❌ Fallaste.', { show_alert: true });
    }

    let userData = null;
    let reward = 0;
    if (!pending.isTest) {
      userData = loadUserData(userId);
      userData.waifus.push({ name: pending.waifu.name, rarity: pending.waifu.rarity, timestamp: Date.now() });
      reward = COINS_REWARD[pending.waifu.rarity] || 10;
      userData.coins = (userData.coins || 0) + reward;
      const ok = saveUserData(userId, userData, ctx.from.first_name, ctx.from.username || null);
      if (!ok) {
        userData.waifus.pop();
        userData.coins -= reward;
        const i = pending.attemptedUsers.indexOf(userId);
        if (i !== -1) pending.attemptedUsers.splice(i, 1);
        persistPending();
        return safeAnswerCb(ctx, '❌ No se pudo guardar tu captura. Intenta de nuevo.', { show_alert: true });
      }
    }

    clearTimeout(pending.timer);
    delete pendingWaifus[sessionId];
    persistPending();

    const messageId = ctx.callbackQuery.message.message_id;
    const chatId = ctx.callbackQuery.message.chat.id;

    const emoji = rarityEmojis[pending.waifu.rarity];
    let text;
    if (pending.isTest) text = toFancyText('🎉 ¡Correcto! (Modo prueba)');
    else {
      const stats = countOwnedWaifus(userId);
      text = fancyFormat`${emoji} ¡${ctx.from.first_name} acertó y capturó a ${toFancyText(pending.waifu.name)}!

💰 +${reward} monedas (Total: ${userData.coins})
🍥 Waifus: ${stats.total} (${stats.unique} únicas)`;
    }

    const botonesCaptura = {
      inline_keyboard: [[
        { text: toFancyText('📦 Mi colección'), callback_data: 'ver_coleccion' },
        { text: toFancyText('🏪 Tienda'), callback_data: 'open_shop' }
      ], [
        { text: toFancyText('📋 Comandos'), callback_data: 'comandos' }
      ]]
    };

    const promise = pending.isPhoto
      ? ctx.editMessageCaption(text, { reply_markup: botonesCaptura })
      : ctx.editMessageText(text, { reply_markup: botonesCaptura });
    promise
      .then(() => borrarMensajeDespues(chatId, messageId, DELETE_AFTER_CAPTURE_MS))
      .catch(() => {});
    safeAnswerCb(ctx, '🎉 ¡Correcto!');
  });

  bot.action('ver_coleccion', async (ctx) => { safeAnswerCb(ctx); await enviarColeccion(ctx, ctx.from.id); });

  bot.action(/col_nav_(\d+)/, async (ctx) => {
    const msgId = ctx.callbackQuery.message.message_id;
    const session = collectionSessions[msgId];
    if (!session) return safeAnswerCb(ctx, '⏰ Colección expirada.', { show_alert: true });
    if (session.userId !== ctx.from.id) return safeAnswerCb(ctx, '❌ No es tu colección.', { show_alert: true });
    if (!session.filter) return safeAnswerCb(ctx, '⚠️ Selecciona una rareza primero.', { show_alert: true });

    const newPage = parseInt(ctx.match[1], 10);
    session.page = newPage;
    const { message, keyboard } = buildCollectionContent(session.userId, newPage, session.filter);
    try {
      if (session.isPhoto) await ctx.editMessageCaption(message, { reply_markup: { inline_keyboard: keyboard } });
      else await ctx.editMessageText(message, { reply_markup: { inline_keyboard: keyboard } });
    } catch (e) { console.error('Error pag col:', e.message); }
    safeAnswerCb(ctx);
  });

  bot.action(/^col_filter_(.+)$/, async (ctx) => {
    const msgId = ctx.callbackQuery.message.message_id;
    const session = collectionSessions[msgId];
    if (!session) return safeAnswerCb(ctx, '⏰ Colección expirada.', { show_alert: true });
    if (session.userId !== ctx.from.id) return safeAnswerCb(ctx, '❌ No es tu colección.', { show_alert: true });

    const value = ctx.match[1];
    if (value === 'all') {
      session.filter = null;
    } else {
      if (!RARITY_LABELS[value]) return safeAnswerCb(ctx, '❌ Rareza inválida.', { show_alert: true });
      session.filter = value;
    }
    session.page = 0;

    const { message, keyboard } = buildCollectionContent(session.userId, 0, session.filter);
    try {
      if (session.isPhoto) await ctx.editMessageCaption(message, { reply_markup: { inline_keyboard: keyboard } });
      else await ctx.editMessageText(message, { reply_markup: { inline_keyboard: keyboard } });
    } catch (e) { console.error('col_filter:', e.message); }

    safeAnswerCb(ctx, value === 'all' ? '📦 Menú de rarezas' : `🎯 ${RARITY_LABELS[value]}`);
  });

  bot.action('col_noop', (ctx) => { safeAnswerCb(ctx); });

  // ==================== DROPS AUTOMÁTICOS ====================
  async function sendAutomaticWaifuToAllChats() {
    const chats = loadChatIds();
    console.log(`[Waifus] 📤 Enviando waifu a ${chats.length} chats...`);
    let ok = 0, skipped = 0, failed = 0;

    for (const chatId of chats) {
      try {
        const info = await retryAsync(() => bot.telegram.getChat(chatId), 2, 1500);

        if (info.type === 'private') { skipped++; continue; }

        const waifu = getRandomWaifuWithHistory(chatId);
        updateChatHistory(chatId, waifu.name);

        const emoji = rarityEmojis[waifu.rarity];
        const serie = waifuSeries[waifu.name] || 'Desconocida';
        const text = fancyFormat`¡Ha aparecido una waifu salvaje!

${emoji} Rareza: ${toFancyText(waifu.rarity)}
📺 Origen: ${toFancyText(serie)}

💰 Recompensa: ${COINS_REWARD[waifu.rarity]} monedas
⏳ ${CAPTURE_TIME_MIN} minutos para capturarla.

¿Cuál es su nombre?`;

        sendWaifuWithTimer(chatId, waifu, text, false);
        ok++;
      } catch (e) {
        failed++;
        console.error(`[Waifus] ❌ Chat ${chatId} falló:`, e.message);
        const msg = String(e.message || '');
        if (/chat not found|kicked|bot was blocked|CHAT_WRITE_FORBIDDEN|not enough rights/i.test(msg)) {
          removeChatId(chatId);
          console.log(`[Waifus] 🗑️ Chat ${chatId} removido de chats.json`);
        }
      }
      await new Promise(r => { const t = setTimeout(r, 500); if (t.unref) t.unref(); });
    }

    console.log(`[Waifus] ✅ Drop terminado → ok: ${ok}, privados omitidos: ${skipped}, fallidos: ${failed}`);
  }

  async function triggerDrop() {
    console.log('[Waifus] ⏰ Ejecutando drop automático...');
    try {
      await sendAutomaticWaifuToAllChats();
    } catch (e) {
      console.error('[Waifus] ❌ Error en triggerDrop:', e.message);
    } finally {
      setNextDropTime(Date.now() + DROP_INTERVAL);
      scheduleNextDrop();
    }
  }

  function scheduleNextDrop() {
    let next = getNextDropTime();
    const now = Date.now();
    if (!next) { next = now + DROP_INTERVAL; setNextDropTime(next); }
    const remaining = next - now;
    if (remaining <= 0) { triggerDrop(); }
    else {
      const t = setTimeout(triggerDrop, remaining);
      t.unref?.();
    }
  }

  // ==================== INICIALIZACIÓN ====================
  loadWaifuData();

  try { restorePendingWaifus(); } catch (e) {
    console.error('[Waifus] ⚠️ Error restaurando pendientes:', e.message);
  }

  if (waifuDataLoadedFromFile && isSystemHealthy()) {
    try {
      const startupCleanup = cleanupOrphanedWaifus({ dryRun: false });
      if (startupCleanup.aborted) {
        console.log(`[Waifus] 🛡️ Limpieza inicial OMITIDA: ${startupCleanup.abortReason}`);
      } else if (startupCleanup.totalRemoved > 0) {
        console.log(`[Waifus] 🧹 Limpieza inicial: ${startupCleanup.usersAffected} perfiles, ${startupCleanup.totalRemoved} waifus huérfanas eliminadas.`);
        if (startupCleanup.usersSkipped > 0) {
          console.log(`[Waifus] 🛡️ Perfiles omitidos por seguridad: ${startupCleanup.usersSkipped}`);
        }
        if (startupCleanup.removedNames.size > 0) {
          const nombres = [...startupCleanup.removedNames].slice(0, 10).join(', ');
          const masTxt = startupCleanup.removedNames.size > 10 ? ` (+${startupCleanup.removedNames.size - 10} más)` : '';
          console.log(`[Waifus] 🧹 Nombres eliminados: ${nombres}${masTxt}`);
        }
      } else if (startupCleanup.usersSkipped > 0) {
        console.log(`[Waifus] 🛡️ Limpieza inicial: ${startupCleanup.usersSkipped} perfiles omitidos por seguridad.`);
      } else {
        console.log('[Waifus] ✅ Perfiles limpios (sin waifus huérfanas).');
      }
    } catch (e) {
      console.error('[Waifus] ⚠️ Error en limpieza inicial:', e.message);
    }
  } else {
    const reason = !waifuDataLoadedFromFile
      ? 'waifu_data.json no se cargó desde archivo'
      : 'pool no saludable';
    console.log(`[Waifus] 🛡️ Limpieza inicial OMITIDA (${reason}).`);
  }

  console.log('✅ modulo waifus activado');
  console.log(`⏳ Tiempo de captura: ${CAPTURE_TIME_MIN} minutos`);
  console.log(`🗑️ TTL tras captura: ${DELETE_AFTER_CAPTURE_MS / 1000} segundos`);
  console.log(`⭐ Botón "Apoya el bot" activado — ${DONAR_ESTRELLAS_CANTIDAD} estrellas → ${DONAR_RECOMPENSA_LEGENDARIAS} waifus legendarias de regalo`);
  console.log('💠 /start caja_suprema delegado a cajas.js');
  console.log('💎 /start plus delegado a tienda.js (Suscripción Plus)');
  console.log('🖼️ SKINS: /ver prioriza SKIN activa > Portada animada > Imagen estática');
  console.log('🎁 Comandos admin: /adminwaifu (regalar waifu) y /admincoins (regalar/quitar monedas)');
  console.log('🎨 Comando admin: /agregarportada (portadas animadas para waifus)');
  console.log('📋 Comando admin: /chatsregistrados (ver grupos registrados)');
  console.log('🧹 Comando admin: /limpiarperfiles (dry-run) — usa "confirmar" para ejecutar');
  console.log('💾 Persistencia de waifus pendientes activada (pending_waifus.json)');
  console.log('🔗 API pública expuesta para otros módulos (IA, regalar, etc.)');
  scheduleNextDrop();

  // ==================== API PÚBLICA ====================
  return {
    getAllWaifus: () => {
      const all = [];
      for (const r in waifuPool) {
        for (const n of waifuPool[r].characters) {
          all.push({ name: n, rarity: r });
        }
      }
      for (const n of listExclusiveNames()) {
        all.push({ name: n, rarity: 'exclusiva' });
      }
      return all;
    },

    getOwnedAndMissing: (userId) => {
      const ud = loadUserData(userId);
      const ownedSet = new Set();
      for (const w of ud.waifus || []) {
        if (w && w.name) ownedSet.add(String(w.name).toLowerCase());
      }

      const all = [];
      for (const r in waifuPool) {
        for (const n of waifuPool[r].characters) all.push({ name: n, rarity: r });
      }
      for (const n of listExclusiveNames()) all.push({ name: n, rarity: 'exclusiva' });

      const owned   = all.filter(w => ownedSet.has(w.name.toLowerCase()));
      const missing = all.filter(w => !ownedSet.has(w.name.toLowerCase()));

      const rarityCount = { comun: 0, rara: 0, epica: 0, legendaria: 0, exclusiva: 0 };
      for (const w of owned) {
        if (rarityCount[w.rarity] != null) rarityCount[w.rarity]++;
      }

      const stats = countOwnedWaifus(userId);

      return {
        coins: ud.coins || 0,
        totalOwned: owned.length,
        totalCatalog: all.length,
        totalCaptures: stats.total,
        onSale: stats.onSale,
        predeterminada: ud.predeterminada || null,
        owned,
        missing,
        rarity: rarityCount
      };
    },

    getSeries: (name) => waifuSeries[name] || null,

    findWaifuByName: (name) => findWaifuByName(name),

    getRarity: (name) => {
      const f = findWaifuByName(name);
      if (f) return f.rarity;
      if (findExclusiveWaifu(name)) return 'exclusiva';
      return null;
    },

    loadUserData: (userId) => loadUserData(userId),
    saveUserData: (userId, data, firstName = null, username = null) => saveUserData(userId, data, firstName, username),
    countOwnedWaifus: (userId) => countOwnedWaifus(userId),
    getAllWaifuNames: () => getAllWaifuNames(),
    listExclusiveNames: () => listExclusiveNames(),

    cleanupOrphanedWaifus: (options = {}) => cleanupOrphanedWaifus(options),
    waifuExistsInSystem: (name) => waifuExistsInSystem(name),
    isSystemHealthy: () => isSystemHealthy()
  };
};