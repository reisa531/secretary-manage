import { query, queryOne } from './db.js';

const DEFAULT_SETTINGS = {
  site_name: '团支部管理平台',
  org_name: '××大学××学院××团支部',

  smtp_host: '',
  smtp_port: '465',
  smtp_secure: '1',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  smtp_from_name: '团支部',

  ai_provider: 'openai',
  ai_base_url: 'https://api.deepseek.com/v1',
  ai_api_key: '',
  ai_model: 'deepseek-chat',
  ai_temperature: '0.7',

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
    { name: '团务百科', url: 'https://zhtj.youth.cn/zhtj/twbk/twLearning', desc: '团务知识百科' },
  ]),
};

export async function getSetting(key, fallback = '') {
  const row = await queryOne('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)]
  );
}

export async function getJSONSetting(key, fallback) {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function seedDefaults() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, String(value)]
    );
  }
}
