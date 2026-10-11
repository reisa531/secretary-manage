import { query, queryOne } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { seedDefaults } from './settings.js';
import { hashPassword } from './auth.js';

// 懒执行一次：自动建表（幂等）+ 种子默认设置 + 首次启动创建管理员。首次请求触发。
let readyPromise = null;

async function ensureBootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await queryOne(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (!existing) {
    await query(
      'INSERT INTO users (email, password_hash, name, role, email_verified) VALUES ($1,$2,$3,$4,true)',
      [String(email).trim().toLowerCase(), hashPassword(password), '管理员', 'admin']
    );
    console.log('[bootstrap] 已创建初始管理员账号');
  }
}

export function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await query(SCHEMA_SQL);
      await seedDefaults();
      await ensureBootstrapAdmin();
    })().catch((err) => { console.error('[ensureReady] failed:', err); });
  }
  return readyPromise;
}
