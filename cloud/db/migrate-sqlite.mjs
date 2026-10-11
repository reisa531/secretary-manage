import '../lib/load-env.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { hashPassword } from '../lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudRoot = path.join(__dirname, '..');
const SQLITE_PATH = process.env.SQLITE_DB || path.join(cloudRoot, '..', 'data', 'secretary.db');

if (!existsSync(SQLITE_PATH)) {
  console.error('源 SQLite 数据库不存在：' + SQLITE_PATH);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) { console.error('缺少 DATABASE_URL'); process.exit(1); }
const needsSsl = /(neon\.tech|rds\.amazonaws\.com|azure\.com|render\.com|supabase\.co)/i.test(url);
const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });
const sqlite = new DatabaseSync(SQLITE_PATH);

const MEMBER_COLS = ['name', 'gender', 'birth_date', 'nation', 'native_place', 'political_status', 'join_league_date', 'org_name', 'phone', 'email', 'student_no', 'major', 'league_no', 'league_role', 'zhtj_url', 'hobbies', 'specialties', 'skills', 'volunteer_willing', 'volunteer_types', 'self_intro', 'admin_notes', 'portrait', 'portrait_updated_at', 'tags', 'created_at', 'updated_at'];

async function main() {
  // 1) 设置
  const settings = sqlite.prepare('SELECT key, value FROM settings').all();
  for (const s of settings) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [s.key, s.value]);
  }
  console.log(`settings: ${settings.length} 条`);

  // 2) 管理员用户（由 settings.admin_password + smtp 邮箱生成）
  const adminPw = settings.find((s) => s.key === 'admin_password')?.value || 'admin123';
  const smtpUser = settings.find((s) => s.key === 'smtp_user')?.value || '';
  const smtpFrom = settings.find((s) => s.key === 'smtp_from')?.value || '';
  const adminEmail = (smtpFrom || smtpUser || 'admin@secretary.local').toLowerCase();
  const passwordHash = String(adminPw).startsWith('scrypt$') ? adminPw : hashPassword(adminPw);
  const existingAdmin = await pool.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
  if (existingAdmin.rowCount === 0) {
    await pool.query('INSERT INTO users (email, password_hash, name, role, email_verified) VALUES ($1,$2,$3,$4,true)', [adminEmail, passwordHash, '管理员', 'admin']);
    console.log(`已创建管理员账号: ${adminEmail}`);
  } else {
    console.log('已存在管理员账号，跳过');
  }

  // 3) 成员（跳过已删除的 education/fee_status/status 列）
  const members = sqlite.prepare('SELECT * FROM members ORDER BY id').all();
  const cols = MEMBER_COLS.map((c) => `"${c}"`).join(', ');
  const ph = MEMBER_COLS.map((c, i) => `$${i + 1}`).join(', ');
  for (const m of members) {
    await pool.query(`INSERT INTO members (${cols}) VALUES (${ph})`, MEMBER_COLS.map((c) => m[c] ?? ''));
  }
  console.log(`members: ${members.length} 条`);

  // 4) 活动（participant_ids 字符串 -> jsonb）
  const activities = sqlite.prepare('SELECT * FROM activities ORDER BY id').all();
  for (const a of activities) {
    let pids = [];
    try { pids = JSON.parse(a.participant_ids || '[]'); } catch { pids = []; }
    await pool.query(`INSERT INTO activities (title, type, description, location, start_time, end_time, participant_ids, notify_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.title, a.type, a.description, a.location, a.start_time, a.end_time, JSON.stringify(pids), a.notify_status, a.created_at]);
  }
  console.log(`activities: ${activities.length} 条`);

  // 5) 邮件日志
  const emails = sqlite.prepare('SELECT * FROM email_log ORDER BY id').all();
  for (const e of emails) {
    await pool.query('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.activity_id, e.subject, e.to_list, e.status, e.error, e.sent_at]);
  }
  console.log(`email_log: ${emails.length} 条`);

  // 6) 团费期数与记录
  const periods = sqlite.prepare('SELECT * FROM fee_periods ORDER BY id').all();
  for (const p of periods) {
    await pool.query('INSERT INTO fee_periods (id, period, amount, note, status, created_at, notified_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [p.id, p.period, p.amount, p.note, p.status, p.created_at, p.notified_at || null]);
  }
  console.log(`fee_periods: ${periods.length} 条`);

  const records = sqlite.prepare('SELECT * FROM fee_records ORDER BY id').all();
  for (const r of records) {
    await pool.query('INSERT INTO fee_records (period_id, member_id, status, order_no, updated_at) VALUES ($1,$2,$3,$4,$5)',
      [r.period_id, r.member_id, r.status, r.order_no, r.updated_at]);
  }
  console.log(`fee_records: ${records.length} 条`);

  // 校验
  const mg = await pool.query('SELECT COUNT(*) c FROM members');
  const st = await pool.query('SELECT COUNT(*) c FROM settings');
  console.log(`\n✅ 迁移完成：Postgres members=${mg.rows[0].c} settings=${st.rows[0].c}`);

  sqlite.close();
  await pool.end();
}

main().catch((e) => { console.error('迁移失败:', e); process.exit(1); });
