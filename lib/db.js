'use strict';
/**
 * 数据库层：使用 Node.js 内置 node:sqlite（零外部依赖，本地化部署友好）。
 * 所有表结构、默认设置、种子数据都在这里定义。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// 数据目录可通过环境变量覆盖（Electron 打包后写入用户数据目录，避免写 Program Files）
const DATA_DIR = process.env.SECRETARY_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'secretary.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/* ---------------------------- 建表 ---------------------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  nation TEXT DEFAULT '',
  native_place TEXT DEFAULT '',
  political_status TEXT DEFAULT '',
  join_league_date TEXT DEFAULT '',
  org_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  student_no TEXT DEFAULT '',
  education TEXT DEFAULT '',
  major TEXT DEFAULT '',
  league_no TEXT DEFAULT '',
  league_role TEXT DEFAULT '',
  zhtj_url TEXT DEFAULT '',
  fee_status TEXT DEFAULT '已缴',
  hobbies TEXT DEFAULT '',
  specialties TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  volunteer_willing INTEGER DEFAULT 0,
  volunteer_types TEXT DEFAULT '',
  self_intro TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  portrait TEXT DEFAULT '',
  portrait_updated_at TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  status TEXT DEFAULT '在册',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT DEFAULT '团日活动',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  participant_ids TEXT DEFAULT '[]',
  notify_status TEXT DEFAULT '未通知',
  created_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER,
  subject TEXT DEFAULT '',
  to_list TEXT DEFAULT '',
  status TEXT DEFAULT '',
  error TEXT DEFAULT '',
  sent_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fee_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  status TEXT DEFAULT '收缴中',
  created_at TEXT DEFAULT '',
  notified_at TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fee_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  status TEXT DEFAULT '未缴',
  order_no TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  UNIQUE(period_id, member_id)
);
`);

/* ---------------------------- 工具函数 ---------------------------- */
function now() {
  return new Date().toISOString();
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function getJSONSetting(key, fallback) {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/* ---------------------------- 默认设置 ---------------------------- */
const DEFAULT_SETTINGS = {
  admin_password: 'admin123',
  site_name: '团支部管理平台',
  org_name: '××大学××学院××团支部',

  // SMTP 配置
  smtp_host: '',
  smtp_port: '465',
  smtp_secure: '1', // 0=STARTTLS/明文, 1=SMTPS(465 隐式TLS)
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_from_name: '团支部',

  // AI 配置（OpenAI 兼容接口，覆盖 OpenAI / DeepSeek / 通义 / Ollama 等）
  ai_provider: 'openai', // openai | ollama
  ai_base_url: 'https://api.deepseek.com/v1',
  ai_api_key: '',
  ai_model: 'deepseek-chat',
  ai_temperature: '0.7',

  // 智慧团建路由表（无官方 API，采用超链接形式；可在此维护精确入口）
  zhtj_base_url: 'https://zhtj.youth.cn/zhtj/',
  zhtj_routes: JSON.stringify([
    { name: '系统登录', url: 'https://zhtj.youth.cn/zhtj/', desc: '智慧团建系统统一登录入口' },
    { name: '支部团员大会', url: 'https://zhtj.youth.cn/zhtj/mine/meetinglist/1', desc: '三会：支部团员大会' },
    { name: '支部委员会', url: 'https://zhtj.youth.cn/zhtj/mine/meetinglist/2', desc: '三会：支部委员会' },
    { name: '团小组会', url: 'https://zhtj.youth.cn/zhtj/mine/meetinglist/3', desc: '三会：团小组会' },
    { name: '团课', url: 'https://zhtj.youth.cn/zhtj/mine/classlist', desc: '一课：团课' },
    { name: '两制', url: 'https://zhtj.youth.cn/zhtj/mine/twosystem', desc: '团员教育评议制度与团籍注册制度' },
    { name: '团日活动', url: 'https://zhtj.youth.cn/zhtj/mine/leagueday', desc: '团日活动' },
    { name: '两红两优评选', url: 'https://zhtj.youth.cn/zhtj/mine/excellent/initapplyexcellent', desc: '“两红两优”评选' },
    { name: '团课资源', url: 'https://zhtj.youth.cn/zhtj/mine/leagueClassResource', desc: '团课学习资源' },
    { name: '团务百科', url: 'https://zhtj.youth.cn/zhtj/twbk/twLearning', desc: '团务知识百科' }
  ]),
};

function seedDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) setSetting(key, value);
  }
}
seedDefaults();

module.exports = {
  db,
  DB_PATH,
  now,
  getSetting,
  setSetting,
  getJSONSetting,
};
