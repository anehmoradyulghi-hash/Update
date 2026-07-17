import Database from 'better-sqlite3';

const db = new Database('starkadeh.db');
db.pragma('journal_mode = WAL');

// ===================== SCHEMA =====================
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance_rial INTEGER NOT NULL DEFAULT 0,
  balance_stars INTEGER NOT NULL DEFAULT 0,
  staked_rial INTEGER NOT NULL DEFAULT 0,
  stake_started_at TEXT,
  ref_code TEXT UNIQUE,
  referred_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'link',   -- join_channel | link
  channel_username TEXT,               -- برای type=join_channel، بدون @
  link TEXT,                           -- برای type=link
  reward_rial INTEGER NOT NULL DEFAULT 0,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tg_id, task_id)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price_rial INTEGER NOT NULL,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  amount_rial INTEGER NOT NULL,
  pay_method TEXT NOT NULL,          -- wallet | stars | gateway
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | delivered | failed
  note TEXT,                         -- گیرنده/آیدی اکانت هدف که خریدار وارد کرده
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  type TEXT NOT NULL,                -- in | out
  currency TEXT NOT NULL,            -- rial | stars
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gateway_payments (
  authority TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL,
  amount_rial INTEGER NOT NULL,
  purpose TEXT NOT NULL,             -- topup | order:<id>
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  amount_rial INTEGER NOT NULL,
  card_last4 TEXT,
  track_code TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS market_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_tg_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_rial INTEGER NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',    -- active | reserved | sold | cancelled
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  buyer_tg_id INTEGER NOT NULL,
  seller_tg_id INTEGER NOT NULL,
  price_rial INTEGER NOT NULL,
  fee_rial INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_transfer', -- pending_transfer | completed | disputed | refunded | cancelled
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
`);

// ===================== SAFE MIGRATIONS (برای دیتابیس‌هایی که قبلاً دیپلوی شده‌اند) =====================
function tryAddColumn(sql) {
  try { db.exec(sql); } catch (e) { /* column already exists — ignore */ }
}
tryAddColumn(`ALTER TABLE products ADD COLUMN image_url TEXT`);
tryAddColumn(`ALTER TABLE orders ADD COLUMN note TEXT`);
tryAddColumn(`ALTER TABLE users ADD COLUMN staked_rial INTEGER NOT NULL DEFAULT 0`);
tryAddColumn(`ALTER TABLE users ADD COLUMN stake_started_at TEXT`);
tryAddColumn(`ALTER TABLE users ADD COLUMN last_spin_at TEXT`);

// ===================== SEED PRODUCTS (run once) =====================
const seed = db.prepare('SELECT COUNT(*) c FROM products').get();
if (seed.c === 0) {
  const insert = db.prepare(`INSERT INTO products (id, category, name, description, price_rial) VALUES (?,?,?,?,?)`);
  const seedData = [
    ['st100', 'stars', '۱۰۰ استارز', 'واریز آنی به اکانت تلگرام', 39000],
    ['st500', 'stars', '۵۰۰ استارز', 'واریز آنی + ۵٪ تخفیف حجمی', 185000],
    ['pm1', 'premium', 'پرمیوم ۱ ماهه', 'فعال‌سازی مستقیم — آیدی اکانت مقصد رو موقع خرید وارد کن', 169000],
    ['gc-gp', 'gift', 'گیفت‌کارت Google Play ۲۰$', 'کد دیجیتال', 1150000],
  ];
  const tx = db.transaction((rows) => rows.forEach(r => insert.run(...r)));
  tx(seedData);
}

// مارکت گیفت (گیفت‌های پروفایل تلگرام) — جدا از سید بالا تا رو دیتابیس‌های قبلی هم اضافه بشه
const giftMarketSeed = db.prepare(`SELECT COUNT(*) c FROM products WHERE category='giftmarket'`).get();
if (giftMarketSeed.c === 0) {
  const insert = db.prepare(`INSERT INTO products (id, category, name, description, price_rial) VALUES (?,?,?,?,?)`);
  const rows = [
    ['gm-rose', 'giftmarket', 'گیفت رز 🌹', 'ارسال به پروفایل هر کاربر — آیدی گیرنده رو موقع خرید وارد کن', 79000],
    ['gm-heart', 'giftmarket', 'گیفت قلب ❤️', 'ارسال به پروفایل هر کاربر — آیدی گیرنده رو موقع خرید وارد کن', 79000],
    ['gm-diamond', 'giftmarket', 'گیفت الماس 💎', 'گیفت ویژه با نمایش خاص در پروفایل', 349000],
    ['gm-crown', 'giftmarket', 'گیفت تاج 👑', 'کمیاب‌ترین گیفت مارکت', 890000],
  ];
  const tx = db.transaction((data) => data.forEach(r => insert.run(...r)));
  tx(rows);
}

// تسک‌های پیش‌فرض (فقط یک‌بار)
const taskSeed = db.prepare('SELECT COUNT(*) c FROM tasks').get();
if (taskSeed.c === 0) {
  db.prepare(`INSERT INTO tasks (id, title, description, type, channel_username, reward_rial, active) VALUES (?,?,?,?,?,?,1)`)
    .run('join-main-channel', 'عضویت در کانال استارکده', 'عضو کانال شو و ۱۰,۰۰۰ تومان جایزه بگیر', 'join_channel', 'starkadeh_channel', 10000);
}

// ===================== HELPERS =====================
export function getOrCreateUser(tgUser, referrerCode) {
  let user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgUser.id);
  if (!user) {
    const refCode = 'ref_' + tgUser.id;
    let referredBy = null;
    if (referrerCode) {
      const referrer = db.prepare('SELECT tg_id FROM users WHERE ref_code = ?').get(referrerCode);
      if (referrer && referrer.tg_id !== tgUser.id) referredBy = referrer.tg_id;
    }
    db.prepare(`INSERT INTO users (tg_id, username, first_name, ref_code, referred_by) VALUES (?,?,?,?,?)`)
      .run(tgUser.id, tgUser.username || null, tgUser.first_name || null, refCode, referredBy);
    user = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgUser.id);
  }
  return user;
}

export function getUser(tgId) {
  return db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId);
}

export function adjustBalance(tgId, currency, delta, reason, refId = null) {
  const col = currency === 'stars' ? 'balance_stars' : 'balance_rial';
  db.prepare(`UPDATE users SET ${col} = ${col} + ? WHERE tg_id = ?`).run(delta, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason, ref_id) VALUES (?,?,?,?,?,?)`)
    .run(tgId, delta >= 0 ? 'in' : 'out', currency, Math.abs(delta), reason, refId);
}

// 10% referral commission credited to the referrer's rial balance when a paid order is confirmed
export function payReferralCommission(buyerTgId, orderAmountRial) {
  const buyer = getUser(buyerTgId);
  if (buyer && buyer.referred_by) {
    const commission = Math.floor(orderAmountRial * 0.10);
    if (commission > 0) {
      adjustBalance(buyer.referred_by, 'rial', commission, 'پورسانت رفرال از خرید زیرمجموعه', String(buyerTgId));
    }
  }
}

export function createOrder(tgId, productId, qty, amountRial, payMethod, note = null) {
  const info = db.prepare(`INSERT INTO orders (tg_id, product_id, qty, amount_rial, pay_method, status, note) VALUES (?,?,?,?,?, 'paid', ?)`)
    .run(tgId, productId, qty, amountRial, payMethod, note);
  return info.lastInsertRowid;
}

export function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
}

/* ===================== STAKING ===================== */
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// محاسبه و واریز پاداش انباشته‌شده تا همین لحظه، بعد تایمر رو ریست می‌کنه (checkpoint)
export function settleStake(tgId, aprPercent) {
  const user = getUser(tgId);
  if (!user.staked_rial || !user.stake_started_at) return;
  const elapsedMs = Date.now() - new Date(user.stake_started_at + 'Z').getTime();
  const reward = Math.floor(user.staked_rial * (aprPercent / 100) * (elapsedMs / YEAR_MS));
  db.prepare(`UPDATE users SET stake_started_at = datetime('now') WHERE tg_id = ?`).run(tgId);
  if (reward > 0) {
    adjustBalance(tgId, 'rial', reward, 'پاداش استیکینگ');
  }
}

export function pendingStakeReward(user, aprPercent) {
  if (!user.staked_rial || !user.stake_started_at) return 0;
  const elapsedMs = Date.now() - new Date(user.stake_started_at + 'Z').getTime();
  return Math.floor(user.staked_rial * (aprPercent / 100) * (elapsedMs / YEAR_MS));
}

export function stakeDeposit(tgId, amount, aprPercent, capRial) {
  settleStake(tgId, aprPercent);
  const user = getUser(tgId);
  if (user.balance_rial < amount) throw new Error('موجودی کیف‌پول کافی نیست');
  if (user.staked_rial + amount > capRial) throw new Error(`سقف استیکینگ ${capRial.toLocaleString()} تومانه`);
  db.prepare(`UPDATE users SET balance_rial = balance_rial - ?, staked_rial = staked_rial + ?, stake_started_at = COALESCE(stake_started_at, datetime('now')) WHERE tg_id = ?`)
    .run(amount, amount, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason) VALUES (?,?,?,?,?)`)
    .run(tgId, 'out', 'rial', amount, 'واریز به استیکینگ');
}

export function stakeWithdraw(tgId, amount, aprPercent) {
  settleStake(tgId, aprPercent);
  const user = getUser(tgId);
  if (amount > user.staked_rial) throw new Error('مبلغ بیشتر از موجودی استیک‌شده است');
  db.prepare(`UPDATE users SET balance_rial = balance_rial + ?, staked_rial = staked_rial - ? WHERE tg_id = ?`)
    .run(amount, amount, tgId);
  db.prepare(`INSERT INTO transactions (tg_id, type, currency, amount, reason) VALUES (?,?,?,?,?)`)
    .run(tgId, 'in', 'rial', amount, 'برداشت از استیکینگ');
}

/* ===================== TASKS ===================== */
export function listActiveTasks() {
  return db.prepare('SELECT * FROM tasks WHERE active = 1 ORDER BY created_at').all();
}
export function isTaskDone(tgId, taskId) {
  return !!db.prepare('SELECT 1 FROM task_completions WHERE tg_id = ? AND task_id = ?').get(tgId, taskId);
}
export function completeTask(tgId, task) {
  db.prepare('INSERT OR IGNORE INTO task_completions (tg_id, task_id) VALUES (?,?)').run(tgId, task.id);
  if (task.reward_rial) adjustBalance(tgId, 'rial', task.reward_rial, `پاداش تسک: ${task.title}`);
  if (task.reward_stars) adjustBalance(tgId, 'stars', task.reward_stars, `پاداش تسک: ${task.title}`);
}

/* ===================== CARD-TO-CARD TOP-UP ===================== */
export function createCardTopup(tgId, amountRial, cardLast4, trackCode, note) {
  const info = db.prepare(`INSERT INTO card_topups (tg_id, amount_rial, card_last4, track_code, note) VALUES (?,?,?,?,?)`)
    .run(tgId, amountRial, cardLast4 || null, trackCode || null, note || null);
  return info.lastInsertRowid;
}
export function listCardTopups(status) {
  return status
    ? db.prepare(`SELECT c.*, u.username, u.first_name FROM card_topups c JOIN users u ON u.tg_id=c.tg_id WHERE c.status=? ORDER BY c.created_at DESC`).all(status)
    : db.prepare(`SELECT c.*, u.username, u.first_name FROM card_topups c JOIN users u ON u.tg_id=c.tg_id ORDER BY c.created_at DESC`).all();
}
export function getCardTopup(id) {
  return db.prepare('SELECT * FROM card_topups WHERE id = ?').get(id);
}
export function approveCardTopup(id) {
  const row = getCardTopup(id);
  if (!row) throw new Error('درخواست پیدا نشد');
  if (row.status !== 'pending') throw new Error('این درخواست قبلاً بررسی شده');
  db.prepare(`UPDATE card_topups SET status='approved', reviewed_at=datetime('now') WHERE id=?`).run(id);
  adjustBalance(row.tg_id, 'rial', row.amount_rial, 'شارژ کیف‌پول (کارت‌به‌کارت)', String(id));
  return row;
}
export function rejectCardTopup(id, adminNote) {
  const row = getCardTopup(id);
  if (!row) throw new Error('درخواست پیدا نشد');
  if (row.status !== 'pending') throw new Error('این درخواست قبلاً بررسی شده');
  db.prepare(`UPDATE card_topups SET status='rejected', admin_note=?, reviewed_at=datetime('now') WHERE id=?`).run(adminNote || null, id);
  return row;
}

/* ===================== P2P GIFT MARKETPLACE (مثل پرتال) ===================== */
export function createListing(tgId, title, description, priceRial, imageUrl) {
  const info = db.prepare(`INSERT INTO market_listings (seller_tg_id, title, description, price_rial, image_url) VALUES (?,?,?,?,?)`)
    .run(tgId, title, description || null, priceRial, imageUrl || null);
  return info.lastInsertRowid;
}
export function listActiveListings(excludeTgId) {
  return db.prepare(`
    SELECT l.*, u.username, u.first_name FROM market_listings l
    JOIN users u ON u.tg_id = l.seller_tg_id
    WHERE l.status='active' AND l.seller_tg_id != ?
    ORDER BY l.created_at DESC
  `).all(excludeTgId || 0);
}
export function myListings(tgId) {
  return db.prepare('SELECT * FROM market_listings WHERE seller_tg_id = ? ORDER BY created_at DESC').all(tgId);
}
export function getListing(id) {
  return db.prepare('SELECT * FROM market_listings WHERE id = ?').get(id);
}
export function cancelListing(id, tgId) {
  const l = getListing(id);
  if (!l) throw new Error('آگهی پیدا نشد');
  if (l.seller_tg_id !== tgId) throw new Error('این آگهی مال شما نیست');
  if (l.status !== 'active') throw new Error('این آگهی دیگر قابل لغو نیست');
  db.prepare(`UPDATE market_listings SET status='cancelled' WHERE id=?`).run(id);
}
export function buyListing(listingId, buyerTgId, feePercent) {
  const listing = getListing(listingId);
  if (!listing) throw new Error('آگهی پیدا نشد');
  if (listing.status !== 'active') throw new Error('این آگهی دیگر در دسترس نیست');
  if (listing.seller_tg_id === buyerTgId) throw new Error('نمی‌تونی آگهی خودتو بخری');
  const buyer = getUser(buyerTgId);
  if (buyer.balance_rial < listing.price_rial) throw new Error('موجودی کیف‌پول کافی نیست');

  const fee = Math.floor(listing.price_rial * (feePercent / 100));
  const runBuy = db.transaction(() => {
    adjustBalance(buyerTgId, 'rial', -listing.price_rial, `خرید از مارکت گیفت: ${listing.title}`, String(listingId));
    db.prepare(`UPDATE market_listings SET status='reserved' WHERE id=?`).run(listingId);
    return db.prepare(`INSERT INTO market_orders (listing_id, buyer_tg_id, seller_tg_id, price_rial, fee_rial) VALUES (?,?,?,?,?)`)
      .run(listingId, buyerTgId, listing.seller_tg_id, listing.price_rial, fee).lastInsertRowid;
  });
  const orderId = runBuy();
  return { orderId, listing };
}
export function getOrder(id) {
  return db.prepare('SELECT * FROM market_orders WHERE id = ?').get(id);
}
export function myPurchases(tgId) {
  return db.prepare(`SELECT o.*, l.title, l.image_url FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE o.buyer_tg_id=? ORDER BY o.created_at DESC`).all(tgId);
}
export function mySales(tgId) {
  return db.prepare(`SELECT o.*, l.title, l.image_url FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE o.seller_tg_id=? ORDER BY o.created_at DESC`).all(tgId);
}
export function confirmOrderReceipt(orderId, buyerTgId) {
  const order = getOrder(orderId);
  if (!order) throw new Error('سفارش پیدا نشد');
  if (order.buyer_tg_id !== buyerTgId) throw new Error('این سفارش مال شما نیست');
  if (order.status !== 'pending_transfer') throw new Error('این سفارش قابل تایید نیست');
  const payout = order.price_rial - order.fee_rial;
  db.prepare(`UPDATE market_orders SET status='completed', completed_at=datetime('now') WHERE id=?`).run(orderId);
  db.prepare(`UPDATE market_listings SET status='sold' WHERE id=?`).run(order.listing_id);
  adjustBalance(order.seller_tg_id, 'rial', payout, 'فروش در مارکت گیفت (کارمزد کسر شد)', String(orderId));
  return order;
}
export function disputeOrder(orderId, tgId) {
  const order = getOrder(orderId);
  if (!order) throw new Error('سفارش پیدا نشد');
  if (order.buyer_tg_id !== tgId && order.seller_tg_id !== tgId) throw new Error('این سفارش مال شما نیست');
  if (order.status !== 'pending_transfer') throw new Error('این سفارش قابل اعتراض نیست');
  db.prepare(`UPDATE market_orders SET status='disputed' WHERE id=?`).run(orderId);
  return order;
}
export function adminReleaseOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new Error('سفارش پیدا نشد');
  if (!['pending_transfer', 'disputed'].includes(order.status)) throw new Error('این سفارش قابل آزادسازی نیست');
  const payout = order.price_rial - order.fee_rial;
  db.prepare(`UPDATE market_orders SET status='completed', completed_at=datetime('now') WHERE id=?`).run(orderId);
  db.prepare(`UPDATE market_listings SET status='sold' WHERE id=?`).run(order.listing_id);
  adjustBalance(order.seller_tg_id, 'rial', payout, 'فروش در مارکت گیفت (تایید ادمین)', String(orderId));
  return order;
}
export function adminRefundOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new Error('سفارش پیدا نشد');
  if (!['pending_transfer', 'disputed'].includes(order.status)) throw new Error('این سفارش قابل استرداد نیست');
  db.prepare(`UPDATE market_orders SET status='refunded' WHERE id=?`).run(orderId);
  db.prepare(`UPDATE market_listings SET status='active' WHERE id=?`).run(order.listing_id);
  adjustBalance(order.buyer_tg_id, 'rial', order.price_rial, 'استرداد خرید مارکت گیفت (تایید ادمین)', String(orderId));
  return order;
}
export function adminListListings() {
  return db.prepare(`
    SELECT l.*, u.username, u.first_name FROM market_listings l
    JOIN users u ON u.tg_id = l.seller_tg_id ORDER BY l.created_at DESC
  `).all();
}
export function adminListOrders() {
  return db.prepare(`
    SELECT o.*, l.title,
      bu.username AS buyer_username, bu.first_name AS buyer_name,
      su.username AS seller_username, su.first_name AS seller_name
    FROM market_orders o
    JOIN market_listings l ON l.id = o.listing_id
    JOIN users bu ON bu.tg_id = o.buyer_tg_id
    JOIN users su ON su.tg_id = o.seller_tg_id
    ORDER BY o.created_at DESC
  `).all();
}
export function adminSetListingStatus(id, status) {
  db.prepare(`UPDATE market_listings SET status=? WHERE id=?`).run(status, id);
}

export default db;
