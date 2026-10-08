'use strict';
/**
 * 团支部管理平台 —— 后端服务（零外部依赖：Node 内置 http / node:sqlite / fetch / crypto）。
 * 启动：node server.js   （默认端口 8081，可用环境变量 PORT 覆盖）
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { db, now, getSetting, setSetting, getJSONSetting } = require('./lib/db');
const { sendMail } = require('./lib/smtp');
const ai = require('./lib/ai');
const { computeBranchStats } = require('./lib/analysis');

const PORT = Number(process.env.PORT) || 8081;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------------------------- 会话与密码 ---------------------------- */
const sessions = new Map(); // token -> expiry

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPassword(input, stored) {
  if (!stored) return false;
  if (String(stored).startsWith('scrypt$')) {
    const [, salt, hash] = String(stored).split('$');
    const calc = crypto.scryptSync(String(input), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
  }
  return String(input) === String(stored); // 兼容默认明文密码
}

function getSmtpConfig() {
  return {
    host: getSetting('smtp_host'),
    port: Number(getSetting('smtp_port') || 465),
    secure: Number(getSetting('smtp_secure') || 1),
    user: getSetting('smtp_user'),
    pass: getSetting('smtp_pass'),
    from: getSetting('smtp_from') || getSetting('smtp_user'),
    fromName: getSetting('smtp_from_name') || getSetting('org_name'),
  };
}

function getAISettings() {
  return {
    ai_provider: getSetting('ai_provider'),
    ai_base_url: getSetting('ai_base_url'),
    ai_api_key: getSetting('ai_api_key'),
    ai_model: getSetting('ai_model'),
    ai_temperature: getSetting('ai_temperature'),
  };
}

/* ---------------------------- HTTP 工具 ---------------------------- */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON 解析失败');
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const exp = sessions.get(token);
  if (!exp) return null;
  if (exp < Date.now()) { sessions.delete(token); return null; }
  return { token };
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) { sendJSON(res, 401, { error: '未登录或会话已过期' }); return null; }
  return user;
}

/* ---------------------------- 静态文件 ---------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(p)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------------------- 成员相关 ---------------------------- */
function memberFromRow(row) {
  if (!row) return null;
  const m = { ...row };
  m.volunteer_willing = Number(m.volunteer_willing) || 0;
  try { m.portrait_obj = m.portrait ? JSON.parse(m.portrait) : null; } catch { m.portrait_obj = null; }
  return m;
}

function listMembers(query = {}) {
  const clauses = [];
  const params = [];
  if (query.q) {
    clauses.push(`(name LIKE ? OR student_no LIKE ? OR league_no LIKE ? OR phone LIKE ? OR email LIKE ? OR major LIKE ? OR org_name LIKE ? OR tags LIKE ?)`);
    const like = '%' + query.q + '%';
    params.push(like, like, like, like, like, like, like, like);
  }
  if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  if (query.volunteer) { clauses.push('volunteer_willing = ?'); params.push(Number(query.volunteer)); }
  if (query.fee_status) { clauses.push('fee_status = ?'); params.push(query.fee_status); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  const sortable = ['name', 'join_league_date', 'created_at', 'updated_at', 'student_no'];
  const sort = sortable.includes(query.sort) ? query.sort : 'id';
  const rows = db.prepare(`SELECT * FROM members ${where} ORDER BY ${sort} ${order}`).all(...params);
  return rows.map(memberFromRow);
}

function getMember(id) {
  return memberFromRow(db.prepare('SELECT * FROM members WHERE id = ?').get(id));
}

function pickMemberFields(body) {
  const f = (k, d = '') => (body[k] === undefined ? d : String(body[k] ?? d));
  return {
    name: f('name'),
    gender: f('gender'),
    birth_date: f('birth_date'),
    nation: f('nation'),
    native_place: f('native_place'),
    political_status: f('political_status'),
    join_league_date: f('join_league_date'),
    org_name: f('org_name'),
    phone: f('phone'),
    email: f('email'),
    student_no: f('student_no'),
    major: f('major'),
    league_no: f('league_no'),
    league_role: f('league_role'),
    zhtj_url: f('zhtj_url'),
    hobbies: f('hobbies'),
    specialties: f('specialties'),
    skills: f('skills'),
    volunteer_willing: Number(body.volunteer_willing) || 0,
    volunteer_types: f('volunteer_types'),
    self_intro: f('self_intro'),
    admin_notes: f('admin_notes'),
    tags: f('tags'),
  };
}

/* ---------------------------- CSV 导入/导出 ---------------------------- */
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function parseCSV(text) {
  // 简单但稳健的 CSV 解析（支持引号与逗号）
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const CSV_COLUMNS = ['name', 'gender', 'birth_date', 'nation', 'native_place', 'political_status', 'join_league_date', 'org_name', 'phone', 'email', 'student_no', 'major', 'league_no', 'league_role', 'hobbies', 'specialties', 'skills', 'volunteer_willing', 'volunteer_types', 'self_intro', 'admin_notes', 'tags'];

function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { imported: 0, skipped: 0 };
  const header = rows[0].map((h) => String(h).trim());
  let imported = 0, skipped = 0;
  const insert = db.prepare(`INSERT INTO members (${CSV_COLUMNS.map((c) => c).join(', ')}, created_at, updated_at) VALUES (${CSV_COLUMNS.map(() => '?').join(', ')}, ?, ?)`);
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (!values.length || !values[0]) { skipped++; continue; }
    const obj = {};
    header.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    if (!obj.name) { skipped++; continue; }
    const t = now();
    const params = CSV_COLUMNS.map((c) => {
      const v = obj[c] === undefined ? '' : obj[c];
      return c === 'volunteer_willing' ? Number(v) || 0 : String(v ?? '');
    });
    insert.run(...params, t, t);
    imported++;
  }
  return { imported, skipped };
}

function exportCSV(members) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const m of members) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(m[c] ?? '')).join(','));
  }
  return '\uFEFF' + lines.join('\r\n'); // BOM 便于 Excel 打开中文
}

/* ---------------------------- 邮件模板 ---------------------------- */
function activityEmailHtml(activity, orgName) {
  const lines = [];
  if (activity.location) lines.push(`<p><strong>地点：</strong>${escapeHtml(activity.location)}</p>`);
  if (activity.start_time) lines.push(`<p><strong>时间：</strong>${escapeHtml(activity.start_time)}</p>`);
  if (activity.description) lines.push(`<p><strong>内容：</strong></p><p>${escapeHtml(activity.description).replace(/\n/g, '<br>')}</p>`);
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.7;max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#c8102e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">【团支部活动通知】${escapeHtml(activity.title)}</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    <p>各位团员：</p>
    <p>现将活动安排通知如下，请提前安排好时间，准时参加。</p>
    <p><strong>活动类型：</strong>${escapeHtml(activity.type)}</p>
    ${lines.join('\n')}
    <p>如有特殊情况不能参加，请提前向团支书请假说明。</p>
    <p style="color:#888;font-size:12px;margin-top:24px;">—— 此邮件由「${escapeHtml(orgName)}」通过团支部管理平台自动发送</p>
  </div>
  </body></html>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------------------- 活动通知 ---------------------------- */
async function notifyActivity(activityId) {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activity) throw new Error('活动不存在');
  let ids = [];
  try { ids = JSON.parse(activity.participant_ids || '[]'); } catch { ids = []; }
  if (!ids.length) throw new Error('该活动尚未添加参与人员');

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT name, email FROM members WHERE id IN (${placeholders})`).all(...ids);
  const recipients = rows.map((r) => r.email).filter(Boolean);
  if (!recipients.length) throw new Error('参与人员均未填写邮箱，无法发送');

  const orgName = getSetting('org_name');
  const result = await sendMail(getSmtpConfig(), {
    to: recipients,
    subject: '【活动通知】' + activity.title,
    html: activityEmailHtml(activity, orgName),
  });

  db.prepare(`INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(activityId, '【活动通知】' + activity.title, recipients.join('; '), result.ok ? '成功' : '失败', result.ok ? '' : result.message, now());

  if (result.ok) {
    db.prepare(`UPDATE activities SET notify_status = '已通知' WHERE id = ?`).run(activityId);
  }
  return { ...result, recipients, count: recipients.length };
}

/* ---------------------------- 团费收缴 ---------------------------- */
// 群众不缴纳团费：团费对象为 political_status != '群众' 的成员
function feeMemberIds() {
  return db.prepare(`SELECT id FROM members WHERE political_status != '群众' OR political_status = ''`).all().map((r) => r.id);
}

function ensureFeeRecords(periodId) {
  const ids = feeMemberIds();
  const ins = db.prepare(`INSERT OR IGNORE INTO fee_records (period_id, member_id, status, order_no, updated_at) VALUES (?, ?, '未缴', '', '')`);
  for (const mid of ids) ins.run(periodId, mid);
}

function refreshFeePeriodStatus(periodId) {
  const sum = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = '已缴' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status = '免缴' THEN 1 ELSE 0 END) AS exempt
    FROM fee_records WHERE period_id = ?`).get(periodId);
  const total = sum.total || 0;
  const paid = sum.paid || 0;
  const exempt = sum.exempt || 0;
  const done = total > 0 && (paid + exempt) >= total;
  db.prepare(`UPDATE fee_periods SET status = ? WHERE id = ?`).run(done ? '已完成' : '收缴中', periodId);
  return { total, paid, exempt, unpaid: Math.max(total - paid - exempt, 0), done };
}

function feePeriodSummary(period) {
  const sum = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = '已缴' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status = '免缴' THEN 1 ELSE 0 END) AS exempt
    FROM fee_records WHERE period_id = ?`).get(period.id);
  const total = sum.total || 0;
  const paid = sum.paid || 0;
  const exempt = sum.exempt || 0;
  return { ...period, total, paid, exempt, unpaid: Math.max(total - paid - exempt, 0) };
}

function feeDraft(period) {
  const subject = `【团费收缴通知】${period.period}`;
  const text = [
    '各位团员：',
    '',
    `现开展「${period.period}」团费收缴工作，请及时完成缴纳。`,
    '',
    `缴纳金额：${period.amount} 元/人`,
    period.note ? `说明：${period.note}` : '',
    '',
    '缴纳完成后请向团支书登记缴费订单号，以便核对。',
  ].join('\n');
  return { subject, text };
}

function feeEmailHtml(period, text) {
  const orgName = getSetting('org_name');
  const body = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.7;max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#c8102e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;"><h2 style="margin:0;font-size:18px;">团费收缴通知</h2></div>
  <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    ${body}
    <p style="color:#888;font-size:12px;margin-top:24px;">—— 此邮件由「${escapeHtml(orgName)}」通过团支部管理平台自动发送</p>
  </div></div>`;
}

/* ---------------------------- 路由表 ---------------------------- */
async function handleAPI(req, res, pathname, method) {
  const seg = pathname.split('/').filter(Boolean); // 去掉空段

  // 登录 / 登出（无需鉴权）
  if (method === 'POST' && seg[0] === 'login') {
    const body = await readJSON(req);
    if (verifyPassword(body.password || '', getSetting('admin_password'))) {
      // 兼容旧明文密码，登录成功后自动升级为哈希
      if (!String(getSetting('admin_password')).startsWith('scrypt$')) {
        setSetting('admin_password', hashPassword(body.password));
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, Date.now() + 7 * 24 * 3600 * 1000);
      res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`);
      return sendJSON(res, 200, { ok: true, token });
    }
    return sendJSON(res, 401, { error: '密码错误' });
  }

  if (method === 'POST' && seg[0] === 'logout') {
    const user = currentUser(req);
    if (user) sessions.delete(user.token);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }

  // 健康检查（无需鉴权，供启动脚本探测）
  if (method === 'GET' && seg[0] === 'health') {
    return sendJSON(res, 200, { ok: true, service: 'secretary-manage', name: getSetting('site_name') });
  }

  // 其余接口统一鉴权
  if (!requireAuth(req, res)) return;

  const id = seg.length > 1 && /^\d+$/.test(seg[1]) ? Number(seg[1]) : null;

  switch (seg[0]) {
    case 'me': return sendJSON(res, 200, { ok: true, site_name: getSetting('site_name'), org_name: getSetting('org_name') });

    /* ---------- 成员 ---------- */
    case 'members': {
      if (seg.length === 1 && method === 'GET') {
        const u = new URL(req.url, 'http://x');
        return sendJSON(res, 200, { members: listMembers(Object.fromEntries(u.searchParams)) });
      }
      if (seg.length === 1 && method === 'POST') {
        const body = await readJSON(req);
        const f = pickMemberFields(body);
        if (!f.name) return sendJSON(res, 400, { error: '姓名不能为空' });
        const t = now();
        const r = db.prepare(`INSERT INTO members (${Object.keys(f).join(',')}, created_at, updated_at) VALUES (${Object.keys(f).map(() => '?').join(',')}, ?, ?)`)
          .run(...Object.values(f), t, t);
        return sendJSON(res, 200, { member: getMember(Number(r.lastInsertRowid)) });
      }
      if (seg.length === 2 && method === 'GET' && id) {
        const m = getMember(id);
        if (!m) return sendJSON(res, 404, { error: '成员不存在' });
        return sendJSON(res, 200, { member: m });
      }
      if (seg.length === 2 && method === 'PUT' && id) {
        const body = await readJSON(req);
        const f = pickMemberFields(body);
        if (!f.name) return sendJSON(res, 400, { error: '姓名不能为空' });
        const keys = Object.keys(f);
        const set = keys.map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE members SET ${set}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => f[k]), now(), id);
        return sendJSON(res, 200, { member: getMember(id) });
      }
      if (seg.length === 2 && method === 'DELETE' && id) {
        db.prepare('DELETE FROM members WHERE id = ?').run(id);
        return sendJSON(res, 200, { ok: true });
      }
      if (seg.length === 2 && seg[1] === 'import' && method === 'POST') {
        const body = await readJSON(req);
        if (body.csv) {
          const r = importCSV(body.csv);
          return sendJSON(res, 200, r);
        }
        if (Array.isArray(body.members)) {
          const f = pickMemberFields;
          let imported = 0;
          const t = now();
          const ins = db.prepare(`INSERT INTO members (${Object.keys(f({})).join(',')}, created_at, updated_at) VALUES (${Object.keys(f({})).map(() => '?').join(',')}, ?, ?)`);
          for (const b of body.members) {
            const m = f(b);
            if (!m.name) continue;
            ins.run(...Object.keys(m).map((k) => m[k]), t, t);
            imported++;
          }
          return sendJSON(res, 200, { imported });
        }
        return sendJSON(res, 400, { error: '需要 csv 或 members 字段' });
      }
      if (seg.length === 2 && seg[1] === 'export' && method === 'GET') {
        const csv = exportCSV(listMembers({}));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="members.csv"' });
        return res.end(csv);
      }
      if (seg.length === 2 && seg[1] === 'batch-portrait' && method === 'POST') {
        const body = await readJSON(req);
        const ids = (body.ids || []).filter((x) => Number.isInteger(Number(x))).map(Number);
        const results = [];
        const settings = getAISettings();
        for (const mid of ids) {
          const m = getMember(mid);
          if (!m) { results.push({ id: mid, ok: false, error: '成员不存在' }); continue; }
          try {
            const portrait = await ai.generateMemberPortrait(m, settings);
            db.prepare('UPDATE members SET portrait = ?, portrait_updated_at = ?, updated_at = ? WHERE id = ?')
              .run(JSON.stringify(portrait), now(), now(), mid);
            results.push({ id: mid, ok: true, portrait });
          } catch (e) {
            results.push({ id: mid, ok: false, error: e.message });
          }
        }
        return sendJSON(res, 200, { results });
      }
      if (seg.length === 3 && seg[2] === 'portrait' && method === 'POST' && id) {
        const m = getMember(id);
        if (!m) return sendJSON(res, 404, { error: '成员不存在' });
        try {
          const portrait = await ai.generateMemberPortrait(m, getAISettings());
          db.prepare('UPDATE members SET portrait = ?, portrait_updated_at = ?, updated_at = ? WHERE id = ?')
            .run(JSON.stringify(portrait), now(), now(), id);
          return sendJSON(res, 200, { ok: true, portrait });
        } catch (e) {
          return sendJSON(res, 500, { error: e.message });
        }
      }
      break;
    }

    /* ---------- 仪表盘 / 数字画像 ---------- */
    case 'dashboard': {
      const members = listMembers({});
      const activities = db.prepare('SELECT * FROM activities ORDER BY id DESC').all();
      const stats = computeBranchStats(members, activities);
      const portraitCount = members.filter((m) => m.portrait).length;
      const emailCount = db.prepare('SELECT COUNT(*) c FROM email_log').get().c;
      const feeActiveCount = db.prepare(`SELECT COUNT(*) c FROM fee_periods WHERE status = '收缴中'`).get().c;
      const recent = members.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 5);
      return sendJSON(res, 200, { total: members.length, active: stats.active, portraitCount, emailCount, activityCount: activities.length, feeActiveCount, recent, stats });
    }

    case 'branch-stats': {
      const members = listMembers({});
      const activities = db.prepare('SELECT * FROM activities ORDER BY id DESC').all();
      const stats = computeBranchStats(members, activities);
      return sendJSON(res, 200, { stats });
    }

    case 'branch-guidance': {
      const members = listMembers({});
      const activities = db.prepare('SELECT * FROM activities ORDER BY id DESC').all();
      const stats = computeBranchStats(members, activities);
      try {
        const guidance = await ai.generateBranchGuidance(stats, getAISettings());
        setSetting('last_guidance', JSON.stringify({ ...guidance, generated_at: now() }));
        return sendJSON(res, 200, { guidance, stats });
      } catch (e) {
        return sendJSON(res, 500, { error: e.message });
      }
    }

    /* ---------- 活动 ---------- */
    case 'activities': {
      if (seg.length === 1 && method === 'GET') {
        const rows = db.prepare('SELECT * FROM activities ORDER BY id DESC').all();
        const activities = rows.map((a) => {
          try { a.participants = JSON.parse(a.participant_ids || '[]').map(Number); } catch { a.participants = []; }
          return a;
        });
        return sendJSON(res, 200, { activities });
      }
      if (seg.length === 1 && method === 'POST') {
        const body = await readJSON(req);
        if (!body.title) return sendJSON(res, 400, { error: '活动标题不能为空' });
        const r = db.prepare(`INSERT INTO activities (title, type, description, location, start_time, end_time, participant_ids, notify_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(body.title, body.type || '团日活动', body.description || '', body.location || '', body.start_time || '', body.end_time || '', JSON.stringify(body.participants || []), '未通知', now());
        return sendJSON(res, 200, { id: Number(r.lastInsertRowid) });
      }
      if (seg.length === 2 && method === 'PUT' && id) {
        const body = await readJSON(req);
        db.prepare(`UPDATE activities SET title=?, type=?, description=?, location=?, start_time=?, end_time=?, participant_ids=? WHERE id=?`)
          .run(body.title, body.type || '团日活动', body.description || '', body.location || '', body.start_time || '', body.end_time || '', JSON.stringify(body.participants || []), id);
        return sendJSON(res, 200, { ok: true });
      }
      if (seg.length === 2 && method === 'DELETE' && id) {
        db.prepare('DELETE FROM activities WHERE id = ?').run(id);
        return sendJSON(res, 200, { ok: true });
      }
      if (seg.length === 3 && seg[2] === 'notify' && method === 'POST' && id) {
        try {
          const r = await notifyActivity(id);
          return sendJSON(res, 200, r);
        } catch (e) {
          return sendJSON(res, 400, { error: e.message });
        }
      }
      break;
    }

    /* ---------- 团费收缴 ---------- */
    case 'fees': {
      // 更新某条缴费记录
      if (seg.length === 3 && seg[1] === 'records' && /^\d+$/.test(seg[2]) && method === 'PUT') {
        const body = await readJSON(req);
        const recordId = Number(seg[2]);
        const rec = db.prepare('SELECT * FROM fee_records WHERE id = ?').get(recordId);
        if (!rec) return sendJSON(res, 404, { error: '缴费记录不存在' });
        const status = ['未缴', '已缴', '免缴'].includes(body.status) ? body.status : rec.status;
        db.prepare('UPDATE fee_records SET status = ?, order_no = ?, updated_at = ? WHERE id = ?')
          .run(status, body.order_no === undefined ? rec.order_no : String(body.order_no ?? ''), now(), recordId);
        const summary = refreshFeePeriodStatus(rec.period_id);
        return sendJSON(res, 200, { ok: true, summary });
      }

      if (seg.length === 1 && method === 'GET') {
        const periods = db.prepare('SELECT * FROM fee_periods ORDER BY id DESC').all().map(feePeriodSummary);
        return sendJSON(res, 200, { periods });
      }

      if (seg.length === 1 && method === 'POST') {
        const body = await readJSON(req);
        if (!body.period) return sendJSON(res, 400, { error: '请填写期数名称' });
        const amount = Number(body.amount);
        if (!(amount >= 0)) return sendJSON(res, 400, { error: '金额必须为非负数字' });
        const r = db.prepare('INSERT INTO fee_periods (period, amount, note, status, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(body.period, amount, body.note || '', '收缴中', now());
        const periodId = Number(r.lastInsertRowid);
        ensureFeeRecords(periodId);
        refreshFeePeriodStatus(periodId);
        return sendJSON(res, 200, { id: periodId });
      }

      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'GET') {
        const period = db.prepare('SELECT * FROM fee_periods WHERE id = ?').get(id);
        if (!period) return sendJSON(res, 404, { error: '收缴期数不存在' });
        ensureFeeRecords(id);
        const summary = refreshFeePeriodStatus(id);
        const records = db.prepare(`SELECT fr.id AS record_id, fr.status, fr.order_no, fr.updated_at, m.id AS member_id, m.name, m.student_no, m.email, m.political_status, m.phone
          FROM fee_records fr JOIN members m ON m.id = fr.member_id
          WHERE fr.period_id = ? ORDER BY m.id`).all(id);
        return sendJSON(res, 200, { period: feePeriodSummary(period), summary, records });
      }

      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'PUT') {
        const body = await readJSON(req);
        db.prepare('UPDATE fee_periods SET period = ?, amount = ?, note = ? WHERE id = ?')
          .run(body.period, Number(body.amount) || 0, body.note || '', id);
        return sendJSON(res, 200, { ok: true });
      }

      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'DELETE') {
        db.prepare('DELETE FROM fee_records WHERE period_id = ?').run(id);
        db.prepare('DELETE FROM fee_periods WHERE id = ?').run(id);
        return sendJSON(res, 200, { ok: true });
      }

      if (seg.length === 3 && seg[2] === 'draft' && method === 'GET' && id) {
        const period = db.prepare('SELECT * FROM fee_periods WHERE id = ?').get(id);
        if (!period) return sendJSON(res, 404, { error: '收缴期数不存在' });
        return sendJSON(res, 200, feeDraft(period));
      }

      if (seg.length === 3 && seg[2] === 'notify' && method === 'POST' && id) {
        const period = db.prepare('SELECT * FROM fee_periods WHERE id = ?').get(id);
        if (!period) return sendJSON(res, 404, { error: '收缴期数不存在' });
        const body = await readJSON(req);
        const draft = feeDraft(period);
        const subject = body.subject || draft.subject;
        const text = body.text !== undefined ? body.text : draft.text;
        const html = feeEmailHtml(period, text);
        ensureFeeRecords(id);
        const rows = db.prepare(`SELECT m.email FROM fee_records fr JOIN members m ON m.id = fr.member_id WHERE fr.period_id = ?`).all(id);
        const recipients = rows.map((r) => r.email).filter(Boolean);
        if (!recipients.length) return sendJSON(res, 400, { error: '团费缴纳对象均未填写邮箱，无法发送' });
        const r = await sendMail(getSmtpConfig(), { to: recipients, subject, html });
        db.prepare('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(null, subject, recipients.join('; '), r.ok ? '成功' : '失败', r.ok ? '' : r.message, now());
        if (r.ok) db.prepare('UPDATE fee_periods SET notified_at = ? WHERE id = ?').run(now(), id);
        return sendJSON(res, r.ok ? 200 : 400, { ...r, count: recipients.length });
      }
      break;
    }

    /* ---------- 邮件 ---------- */
    case 'email': {
      if (seg.length === 2 && seg[1] === 'send' && method === 'POST') {
        const body = await readJSON(req);
        const to = Array.isArray(body.to) ? body.to : String(body.to || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        if (!to.length) return sendJSON(res, 400, { error: '收件人为空' });
        if (!body.subject) return sendJSON(res, 400, { error: '主题不能为空' });
        const r = await sendMail(getSmtpConfig(), { to, subject: body.subject, text: body.text, html: body.html });
        db.prepare('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(null, body.subject, to.join('; '), r.ok ? '成功' : '失败', r.ok ? '' : r.message, now());
        return sendJSON(res, r.ok ? 200 : 400, r);
      }
      if (seg.length === 2 && seg[1] === 'test' && method === 'POST') {
        const body = await readJSON(req);
        const to = body.to || getSetting('smtp_from') || getSetting('smtp_user');
        if (!to) return sendJSON(res, 400, { error: '请先填写收件邮箱或 SMTP 账号' });
        const orgName = getSetting('org_name');
        const r = await sendMail(getSmtpConfig(), {
          to: [to],
          subject: '【测试邮件】' + orgName + ' 邮件功能正常',
          html: `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;padding:20px;">这是一封来自「${escapeHtml(orgName)}」团支部管理平台的测试邮件，表示 SMTP 邮件配置成功。</div>`,
        });
        return sendJSON(res, r.ok ? 200 : 400, r);
      }
      if (seg.length === 2 && seg[1] === 'logs' && method === 'GET') {
        const logs = db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 100').all();
        return sendJSON(res, 200, { logs });
      }
      break;
    }

    /* ---------- 智慧团建路由 ---------- */
    case 'zhtj': {
      if (seg.length === 2 && seg[1] === 'routes' && method === 'GET') {
        return sendJSON(res, 200, {
          base_url: getSetting('zhtj_base_url'),
          routes: getJSONSetting('zhtj_routes', []),
        });
      }
      break;
    }

    /* ---------- AI 测试 ---------- */
    case 'ai': {
      if (seg.length === 2 && seg[1] === 'test' && method === 'POST') {
        try {
          const reply = await ai.chatCompletion(ai.getAIConfig(getAISettings()), [{ role: 'user', content: '请只回复两个字：正常' }]);
          return sendJSON(res, 200, { ok: true, message: 'AI 连接正常，模型回复：' + (reply || '').slice(0, 40) });
        } catch (e) {
          return sendJSON(res, 400, { error: 'AI 连接失败：' + e.message });
        }
      }
      break;
    }

    /* ---------- 设置 ---------- */
    case 'settings': {
      if (method === 'GET') {
        const smtpPass = getSetting('smtp_pass');
        const aiKey = getSetting('ai_api_key');
        return sendJSON(res, 200, {
          site_name: getSetting('site_name'),
          org_name: getSetting('org_name'),
          smtp_host: getSetting('smtp_host'),
          smtp_port: getSetting('smtp_port'),
          smtp_secure: getSetting('smtp_secure'),
          smtp_user: getSetting('smtp_user'),
          smtp_from: getSetting('smtp_from'),
          smtp_from_name: getSetting('smtp_from_name'),
          smtp_pass_set: !!smtpPass,
          ai_provider: getSetting('ai_provider'),
          ai_base_url: getSetting('ai_base_url'),
          ai_model: getSetting('ai_model'),
          ai_temperature: getSetting('ai_temperature'),
          ai_api_key_set: !!aiKey,
          zhtj_base_url: getSetting('zhtj_base_url'),
          zhtj_routes: getJSONSetting('zhtj_routes', []),
          has_admin_password: !!getSetting('admin_password'),
        });
      }
      if (method === 'PUT') {
        const body = await readJSON(req);
        const textKeys = ['site_name', 'org_name', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_from_name', 'ai_provider', 'ai_base_url', 'ai_model', 'ai_temperature', 'zhtj_base_url'];
        for (const k of textKeys) if (body[k] !== undefined) setSetting(k, body[k]);
        // 密码类字段：空=保持，__CLEAR__=清除，其他=更新
        if (body.smtp_pass === '__CLEAR__') setSetting('smtp_pass', '');
        else if (body.smtp_pass) setSetting('smtp_pass', body.smtp_pass);
        if (body.ai_api_key === '__CLEAR__') setSetting('ai_api_key', '');
        else if (body.ai_api_key) setSetting('ai_api_key', body.ai_api_key);
        if (body.admin_password) setSetting('admin_password', hashPassword(body.admin_password));
        if (Array.isArray(body.zhtj_routes)) setSetting('zhtj_routes', JSON.stringify(body.zhtj_routes));
        return sendJSON(res, 200, { ok: true });
      }
      break;
    }

    default:
      return sendJSON(res, 404, { error: '接口不存在' });
  }
  return sendJSON(res, 404, { error: '接口不存在' });
}

/* ---------------------------- 服务器 ---------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname.startsWith('/api/')) {
      await handleAPI(req, res, pathname.slice(5), req.method);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    else res.end();
  }
});

function startServer(port = PORT, host = HOST, onReady) {
  server.listen(port, host, () => {
    const actualPort = server.address().port;
    console.log(`团支部管理平台已启动：http://localhost:${actualPort}`);
    console.log(`数据库：${require('./lib/db').DB_PATH}`);
    console.log('默认管理员密码：admin123（首次登录后请在「设置」中修改）');
    if (onReady) onReady(actualPort);
  });
  return server;
}

// 直接以 node server.js 运行时自动监听；被 require（如 Electron）时不自动启动
if (require.main === module) {
  startServer();
}

module.exports = { server, startServer, PORT, HOST };
