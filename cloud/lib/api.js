import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from './db.js';
import { getSetting, setSetting, getJSONSetting } from './settings.js';
import { ensureReady } from './ready.js';
import { hashPassword, verifyPassword, createToken, verifyToken, getSessionToken, setSessionCookie, clearSessionCookie } from './auth.js';
import { sendMail } from './smtp.js';
import * as ai from './ai.js';
import { computeBranchStats } from './analysis.js';

function now() {
  return new Date().toISOString();
}

/* ============================ 响应工具 ============================ */
function ok(data, status = 200) {
  return Response.json(data, { status });
}
function fail(message, status = 400) {
  return Response.json({ error: message }, { status });
}

/* ============================ 成员 ============================ */
function memberFromRow(row) {
  if (!row) return null;
  const m = { ...row };
  m.volunteer_willing = Number(m.volunteer_willing) || 0;
  try { m.portrait_obj = m.portrait ? JSON.parse(m.portrait) : null; } catch { m.portrait_obj = null; }
  return m;
}

async function listMembers(q = {}) {
  const clauses = [];
  const params = [];
  let i = 1;
  if (q.q) {
    clauses.push(`(name ILIKE $${i} OR student_no ILIKE $${i} OR league_no ILIKE $${i} OR phone ILIKE $${i} OR email ILIKE $${i} OR major ILIKE $${i} OR org_name ILIKE $${i} OR tags ILIKE $${i})`);
    params.push('%' + q.q + '%'); i++;
  }
  if (q.volunteer) { clauses.push(`volunteer_willing = $${i}`); params.push(Number(q.volunteer)); i++; }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const order = q.order === 'asc' ? 'ASC' : 'DESC';
  const rows = await query(`SELECT * FROM members ${where} ORDER BY id ${order}`, params);
  return rows.map(memberFromRow);
}

async function getMember(id) {
  return memberFromRow(await queryOne('SELECT * FROM members WHERE id = $1', [id]));
}

const MEMBER_FIELDS = ['name', 'gender', 'birth_date', 'nation', 'native_place', 'political_status', 'join_league_date', 'org_name', 'phone', 'email', 'student_no', 'major', 'league_no', 'league_role', 'zhtj_url', 'hobbies', 'specialties', 'skills', 'volunteer_willing', 'volunteer_types', 'self_intro', 'admin_notes', 'tags'];

function pickMemberFields(body) {
  const f = (k, d = '') => (body[k] === undefined ? d : String(body[k] ?? d));
  const out = {};
  for (const k of MEMBER_FIELDS) {
    out[k] = k === 'volunteer_willing' ? (Number(body[k]) || 0) : f(k);
  }
  return out;
}

/* ============================ CSV ============================ */
const CSV_COLUMNS = ['name', 'gender', 'birth_date', 'nation', 'native_place', 'political_status', 'join_league_date', 'org_name', 'phone', 'email', 'student_no', 'major', 'league_no', 'league_role', 'hobbies', 'specialties', 'skills', 'volunteer_willing', 'volunteer_types', 'self_intro', 'admin_notes', 'tags'];

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
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

async function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { imported: 0, skipped: 0 };
  const header = rows[0].map((h) => String(h).trim());
  let imported = 0, skipped = 0;
  const cols = CSV_COLUMNS.map((c, idx) => `"${c}"`).join(', ');
  const placeholders = CSV_COLUMNS.map((c, idx) => `$${idx + 1}`).join(', ');
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (!values.length || !values[0]) { skipped++; continue; }
    const obj = {};
    header.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    if (!obj.name) { skipped++; continue; }
    const params = CSV_COLUMNS.map((c) => (c === 'volunteer_willing' ? (Number(obj[c]) || 0) : String(obj[c] ?? '')));
    await query(`INSERT INTO members (${cols}) VALUES (${placeholders})`, params);
    imported++;
  }
  return { imported, skipped };
}

function exportCSV(members) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const m of members) lines.push(CSV_COLUMNS.map((c) => csvEscape(m[c] ?? '')).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

/* ============================ 配置 ============================ */
async function getSmtpConfig() {
  return {
    host: await getSetting('smtp_host'),
    port: Number(await getSetting('smtp_port', '465')),
    secure: Number(await getSetting('smtp_secure', '1')),
    user: await getSetting('smtp_user'),
    pass: await getSetting('smtp_pass'),
    from: (await getSetting('smtp_from')) || (await getSetting('smtp_user')),
    fromName: (await getSetting('smtp_from_name')) || (await getSetting('org_name')),
  };
}

async function getAISettings() {
  return {
    ai_provider: await getSetting('ai_provider'),
    ai_base_url: await getSetting('ai_base_url'),
    ai_api_key: await getSetting('ai_api_key'),
    ai_model: await getSetting('ai_model'),
    ai_temperature: await getSetting('ai_temperature'),
  };
}

/* ============================ 邮件 ============================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function activityEmailHtml(activity, orgName) {
  const lines = [];
  if (activity.location) lines.push(`<p><strong>地点：</strong>${escapeHtml(activity.location)}</p>`);
  if (activity.start_time) lines.push(`<p><strong>时间：</strong>${escapeHtml(activity.start_time)}</p>`);
  if (activity.description) lines.push(`<p><strong>内容：</strong></p><p>${escapeHtml(activity.description).replace(/\n/g, '<br>')}</p>`);
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.7;max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#c8102e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;"><h2 style="margin:0;font-size:18px;">【活动通知】${escapeHtml(activity.title)}</h2></div>
  <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px;">
    <p>各位团员：</p><p>现将活动安排通知如下，请提前安排好时间，准时参加。</p>
    <p><strong>活动类型：</strong>${escapeHtml(activity.type)}</p>${lines.join('\n')}
    <p>如有特殊情况不能参加，请提前向团支书请假说明。</p>
    <p style="color:#888;font-size:12px;margin-top:24px;">—— 此邮件由「${escapeHtml(orgName)}」通过团支部管理平台自动发送</p>
  </div></body></html>`;
}

async function notifyActivity(activityId) {
  const activity = await queryOne('SELECT * FROM activities WHERE id = $1', [activityId]);
  if (!activity) throw new Error('活动不存在');
  const ids = Array.isArray(activity.participant_ids) ? activity.participant_ids : [];
  if (!ids.length) throw new Error('该活动尚未添加参与人员');
  const rows = await query(`SELECT email FROM members WHERE id = ANY($1::int[])`, [ids]);
  const recipients = rows.map((r) => r.email).filter(Boolean);
  if (!recipients.length) throw new Error('参与人员均未填写邮箱，无法发送');
  const orgName = await getSetting('org_name');
  const result = await sendMail(await getSmtpConfig(), { to: recipients, subject: '【活动通知】' + activity.title, html: activityEmailHtml(activity, orgName) });
  await query('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES ($1,$2,$3,$4,$5,now())',
    [activityId, '【活动通知】' + activity.title, recipients.join('; '), result.ok ? '成功' : '失败', result.ok ? '' : result.message]);
  if (result.ok) await query(`UPDATE activities SET notify_status = '已通知' WHERE id = $1`, [activityId]);
  return { ...result, recipients, count: recipients.length };
}

/* ============================ 团费 ============================ */
async function ensureFeeRecords(periodId) {
  await query(`INSERT INTO fee_records (period_id, member_id, status, order_no)
    SELECT $1, id, '未缴', '' FROM members
    WHERE (political_status != '群众' OR political_status = '')
    ON CONFLICT (period_id, member_id) DO NOTHING`, [periodId]);
}

async function refreshFeePeriodStatus(periodId) {
  const sum = await queryOne(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status='已缴' THEN 1 ELSE 0 END),0) AS paid,
    COALESCE(SUM(CASE WHEN status='免缴' THEN 1 ELSE 0 END),0) AS exempt
    FROM fee_records WHERE period_id = $1`, [periodId]);
  const total = Number(sum.total) || 0, paid = Number(sum.paid) || 0, exempt = Number(sum.exempt) || 0;
  const done = total > 0 && (paid + exempt) >= total;
  await query(`UPDATE fee_periods SET status = $1 WHERE id = $2`, [done ? '已完成' : '收缴中', periodId]);
  return { total, paid, exempt, unpaid: Math.max(total - paid - exempt, 0), done };
}

async function feePeriodSummary(period) {
  const sum = await queryOne(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status='已缴' THEN 1 ELSE 0 END),0) AS paid,
    COALESCE(SUM(CASE WHEN status='免缴' THEN 1 ELSE 0 END),0) AS exempt
    FROM fee_records WHERE period_id = $1`, [period.id]);
  const total = Number(sum.total) || 0, paid = Number(sum.paid) || 0, exempt = Number(sum.exempt) || 0;
  return { ...period, total, paid, exempt, unpaid: Math.max(total - paid - exempt, 0) };
}

async function feeDraft(period) {
  const subject = `【团费收缴通知】${period.period}`;
  const text = ['各位团员：', '', `现开展「${period.period}」团费收缴工作，请及时完成缴纳。`, '', `缴纳金额：${period.amount} 元/人`, period.note ? `说明：${period.note}` : '', '', '缴纳完成后请向团支书登记缴费订单号，以便核对。'].join('\n');
  return { subject, text };
}

async function feeEmailHtml(period, text) {
  const orgName = await getSetting('org_name');
  const body = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#222;line-height:1.7;max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:#c8102e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;"><h2 style="margin:0;font-size:18px;">团费收缴通知</h2></div>
  <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px;">${body}
  <p style="color:#888;font-size:12px;margin-top:24px;">—— 此邮件由「${escapeHtml(orgName)}」通过团支部管理平台自动发送</p></div></div>`;
}

/* ============================ 认证 ============================ */
// 主体有两种：admin（管理端用户表）与 member（团员表，投票人）
async function currentPrincipal(req) {
  const payload = verifyToken(getSessionToken(req));
  if (!payload) return null;
  if (payload.type === 'admin') {
    const user = await queryOne(`SELECT * FROM users WHERE id = $1 AND status = 'active'`, [payload.uid]);
    return user ? { type: 'admin', user } : null;
  }
  if (payload.type === 'member') {
    const member = await queryOne('SELECT * FROM members WHERE id = $1', [payload.mid]);
    return member ? { type: 'member', member } : null;
  }
  return null;
}

async function requireAdmin(req) {
  const p = await currentPrincipal(req);
  return p && p.type === 'admin' ? p.user : null;
}

async function requireMember(req) {
  const p = await currentPrincipal(req);
  return p && p.type === 'member' ? p.member : null;
}

/* ============================ 路由 ============================ */
export async function handleRequest(req, path, method) {
  await ensureReady();
  const seg = path.split('/').filter(Boolean);
  const p0 = seg[0] || '';

  /* ---------- 健康检查（无需鉴权） ---------- */
  if (p0 === 'ready' && method === 'GET') {
    const r = await query('SELECT 1 AS ok, current_database() AS db');
    return ok({ ok: true, service: 'secretary-manage-cloud', database: r[0]?.db });
  }

  /* ---------- 认证（无需鉴权） ---------- */
  if (p0 === 'auth') {
    // 管理端登录（邮箱 + 密码）
    if (seg[1] === 'login' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const user = await queryOne('SELECT * FROM users WHERE email = $1', [String(b.email || '').trim().toLowerCase()]);
      if (!user || user.role !== 'admin' || !verifyPassword(b.password, user.password_hash)) return fail('邮箱或密码错误', 401);
      const token = createToken({ type: 'admin', uid: user.id });
      const res = ok({ ok: true, type: 'admin', user: { id: user.id, email: user.email, name: user.name, role: user.role } });
      setSessionCookie(res, token);
      return res;
    }
    // 团员（投票人）登录：姓名 + 学号，与团员库匹配即登录
    if (seg[1] === 'member-login' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const name = String(b.name || '').trim();
      const studentNo = String(b.student_no || '').trim();
      if (!name || !studentNo) return fail('请输入姓名与学号');
      const member = await queryOne('SELECT * FROM members WHERE name = $1 AND student_no = $2', [name, studentNo]);
      if (!member) return fail('姓名与学号不匹配，或该团员不在库中', 401);
      const token = createToken({ type: 'member', mid: member.id });
      const res = ok({ ok: true, type: 'member', member: { id: member.id, name: member.name, student_no: member.student_no } });
      setSessionCookie(res, token);
      return res;
    }
    if (seg[1] === 'logout' && method === 'POST') {
      const res = ok({ ok: true });
      clearSessionCookie(res);
      return res;
    }
    if (seg[1] === 'me' && method === 'GET') {
      const p = await currentPrincipal(req);
      if (!p) return fail('未登录', 401);
      if (p.type === 'admin') return ok({ type: 'admin', user: { id: p.user.id, email: p.user.email, name: p.user.name, role: p.user.role } });
      return ok({ type: 'member', member: { id: p.member.id, name: p.member.name, student_no: p.member.student_no } });
    }
    return fail('接口不存在', 404);
  }

  /* ---------- 公开内容（信息发布/投票，部分需登录） ---------- */
  if (p0 === 'posts') return handlePosts(req, seg, method);
  if (p0 === 'polls') return handlePolls(req, seg, method);

  /* ---------- 以下均为管理端接口（需管理员） ---------- */
  const admin = await requireAdmin(req);
  if (!admin) return fail('未登录或权限不足', 401);

  const id = seg.length > 1 && /^\d+$/.test(seg[1]) ? Number(seg[1]) : null;

  switch (p0) {
    case 'me': return ok({ user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });

    /* ---- 成员 ---- */
    case 'members': {
      if (seg.length === 1 && method === 'GET') {
        const u = new URL(req.url);
        const q = Object.fromEntries(u.searchParams);
        return ok({ members: await listMembers(q) });
      }
      if (seg.length === 1 && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const f = pickMemberFields(b);
        if (!f.name) return fail('姓名不能为空');
        const r = await queryOne(`INSERT INTO members (${MEMBER_FIELDS.map((c) => `"${c}"`).join(', ')}) VALUES (${MEMBER_FIELDS.map((c, i) => `$${i + 1}`).join(', ')}) RETURNING id`, MEMBER_FIELDS.map((c) => f[c]));
        return ok({ member: await getMember(r.id) });
      }
      if (seg.length === 2 && method === 'GET' && id) {
        const m = await getMember(id);
        return m ? ok({ member: m }) : fail('成员不存在', 404);
      }
      if (seg.length === 2 && method === 'PUT' && id) {
        const b = await req.json().catch(() => ({}));
        const f = pickMemberFields(b);
        if (!f.name) return fail('姓名不能为空');
        const set = MEMBER_FIELDS.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
        await query(`UPDATE members SET ${set}, updated_at = now() WHERE id = $${MEMBER_FIELDS.length + 1}`, [...MEMBER_FIELDS.map((c) => f[c]), id]);
        return ok({ member: await getMember(id) });
      }
      if (seg.length === 2 && method === 'DELETE' && id) {
        await query('DELETE FROM members WHERE id = $1', [id]);
        return ok({ ok: true });
      }
      if (seg.length === 2 && seg[1] === 'import' && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (b.csv) return ok(await importCSV(b.csv));
        return fail('需要 csv 字段');
      }
      if (seg.length === 2 && seg[1] === 'export' && method === 'GET') {
        const csv = exportCSV(await listMembers({}));
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="members.csv"' } });
      }
      if (seg.length === 3 && seg[2] === 'portrait' && method === 'POST' && id) {
        const m = await getMember(id);
        if (!m) return fail('成员不存在', 404);
        const portrait = await ai.generateMemberPortrait(m, await getAISettings());
        await query('UPDATE members SET portrait = $1, portrait_updated_at = $2, updated_at = now() WHERE id = $3', [JSON.stringify(portrait), now(), id]);
        return ok({ ok: true, portrait });
      }
      if (seg.length === 2 && seg[1] === 'batch-portrait' && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const ids = (b.ids || []).filter((x) => Number.isInteger(Number(x))).map(Number);
        const settings = await getAISettings();
        const results = [];
        for (const mid of ids) {
          const m = await getMember(mid);
          if (!m) { results.push({ id: mid, ok: false, error: '成员不存在' }); continue; }
          const portrait = await ai.generateMemberPortrait(m, settings);
          await query('UPDATE members SET portrait = $1, portrait_updated_at = $2, updated_at = now() WHERE id = $3', [JSON.stringify(portrait), now(), mid]);
          results.push({ id: mid, ok: true, portrait });
        }
        return ok({ results });
      }
      break;
    }

    /* ---- 仪表盘 / 数字画像 ---- */
    case 'dashboard': {
      const members = await listMembers({});
      const activities = await query('SELECT * FROM activities ORDER BY id DESC');
      const stats = computeBranchStats(members, activities);
      const portraitCount = members.filter((m) => m.portrait).length;
      const emailCount = Number((await queryOne('SELECT COUNT(*) c FROM email_log')).c);
      const feeActiveCount = Number((await queryOne(`SELECT COUNT(*) c FROM fee_periods WHERE status='收缴中'`)).c);
      const recent = members.slice().sort((a, b) => (b.created_at || '').toString().localeCompare((a.created_at || '').toString())).slice(0, 5);
      return ok({ total: members.length, active: stats.active, portraitCount, emailCount, activityCount: activities.length, feeActiveCount, recent, stats });
    }

    case 'branch-stats': {
      const members = await listMembers({});
      const activities = await query('SELECT * FROM activities ORDER BY id DESC');
      return ok({ stats: computeBranchStats(members, activities) });
    }

    case 'branch-guidance': {
      const members = await listMembers({});
      const activities = await query('SELECT * FROM activities ORDER BY id DESC');
      const stats = computeBranchStats(members, activities);
      try {
        const guidance = await ai.generateBranchGuidance(stats, await getAISettings());
        await setSetting('last_guidance', JSON.stringify({ ...guidance, generated_at: now() }));
        return ok({ guidance, stats });
      } catch (e) { return fail(e.message, 500); }
    }

    /* ---- 活动 ---- */
    case 'activities': {
      if (seg.length === 1 && method === 'GET') {
        const rows = await query('SELECT * FROM activities ORDER BY id DESC');
        return ok({ activities: rows });
      }
      if (seg.length === 1 && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!b.title) return fail('活动标题不能为空');
        const r = await queryOne(`INSERT INTO activities (title, type, description, location, start_time, end_time, participant_ids, notify_status, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'未通知',now()) RETURNING id`,
          [b.title, b.type || '团日活动', b.description || '', b.location || '', b.start_time || '', b.end_time || '', JSON.stringify(b.participants || [])]);
        return ok({ id: r.id });
      }
      if (seg.length === 2 && method === 'PUT' && id) {
        const b = await req.json().catch(() => ({}));
        await query(`UPDATE activities SET title=$1, type=$2, description=$3, location=$4, start_time=$5, end_time=$6, participant_ids=$7 WHERE id=$8`,
          [b.title, b.type || '团日活动', b.description || '', b.location || '', b.start_time || '', b.end_time || '', JSON.stringify(b.participants || []), id]);
        return ok({ ok: true });
      }
      if (seg.length === 2 && method === 'DELETE' && id) {
        await query('DELETE FROM activities WHERE id = $1', [id]);
        return ok({ ok: true });
      }
      if (seg.length === 3 && seg[2] === 'notify' && method === 'POST' && id) {
        try { return ok(await notifyActivity(id)); } catch (e) { return fail(e.message); }
      }
      break;
    }

    /* ---- 团费 ---- */
    case 'fees': {
      if (seg.length === 3 && seg[1] === 'records' && /^\d+$/.test(seg[2]) && method === 'PUT') {
        const b = await req.json().catch(() => ({}));
        const rec = await queryOne('SELECT * FROM fee_records WHERE id = $1', [Number(seg[2])]);
        if (!rec) return fail('缴费记录不存在', 404);
        const status = ['未缴', '已缴', '免缴'].includes(b.status) ? b.status : rec.status;
        await query('UPDATE fee_records SET status=$1, order_no=$2, updated_at=now() WHERE id=$3',
          [status, b.order_no === undefined ? rec.order_no : String(b.order_no ?? ''), Number(seg[2])]);
        return ok({ ok: true, summary: await refreshFeePeriodStatus(rec.period_id) });
      }
      if (seg.length === 1 && method === 'GET') {
        const periods = await query('SELECT * FROM fee_periods ORDER BY id DESC');
        const out = [];
        for (const p of periods) out.push(await feePeriodSummary(p));
        return ok({ periods: out });
      }
      if (seg.length === 1 && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        if (!b.period) return fail('请填写期数名称');
        const amount = Number(b.amount);
        if (!(amount >= 0)) return fail('金额必须为非负数字');
        const r = await queryOne(`INSERT INTO fee_periods (period, amount, note, status, created_at) VALUES ($1,$2,$3,'收缴中',now()) RETURNING id`, [b.period, amount, b.note || '']);
        await ensureFeeRecords(r.id);
        await refreshFeePeriodStatus(r.id);
        return ok({ id: r.id });
      }
      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'GET') {
        const period = await queryOne('SELECT * FROM fee_periods WHERE id = $1', [id]);
        if (!period) return fail('收缴期数不存在', 404);
        await ensureFeeRecords(id);
        const summary = await refreshFeePeriodStatus(id);
        const records = await query(`SELECT fr.id AS record_id, fr.status, fr.order_no, fr.updated_at, m.id AS member_id, m.name, m.student_no, m.email, m.political_status, m.phone
          FROM fee_records fr JOIN members m ON m.id = fr.member_id WHERE fr.period_id = $1 ORDER BY m.id`, [id]);
        return ok({ period: await feePeriodSummary(period), summary, records });
      }
      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'PUT') {
        const b = await req.json().catch(() => ({}));
        await query('UPDATE fee_periods SET period=$1, amount=$2, note=$3 WHERE id=$4', [b.period, Number(b.amount) || 0, b.note || '', id]);
        return ok({ ok: true });
      }
      if (seg.length === 2 && /^\d+$/.test(seg[1]) && method === 'DELETE') {
        await query('DELETE FROM fee_periods WHERE id = $1', [id]);
        return ok({ ok: true });
      }
      if (seg.length === 3 && seg[2] === 'draft' && method === 'GET' && id) {
        const period = await queryOne('SELECT * FROM fee_periods WHERE id = $1', [id]);
        return period ? ok(await feeDraft(period)) : fail('收缴期数不存在', 404);
      }
      if (seg.length === 3 && seg[2] === 'notify' && method === 'POST' && id) {
        const period = await queryOne('SELECT * FROM fee_periods WHERE id = $1', [id]);
        if (!period) return fail('收缴期数不存在', 404);
        const b = await req.json().catch(() => ({}));
        const draft = await feeDraft(period);
        const subject = b.subject || draft.subject;
        const text = b.text !== undefined ? b.text : draft.text;
        await ensureFeeRecords(id);
        const rows = await query(`SELECT m.email FROM fee_records fr JOIN members m ON m.id = fr.member_id WHERE fr.period_id = $1`, [id]);
        const recipients = rows.map((r) => r.email).filter(Boolean);
        if (!recipients.length) return fail('团费缴纳对象均未填写邮箱，无法发送');
        const r = await sendMail(await getSmtpConfig(), { to: recipients, subject, html: await feeEmailHtml(period, text) });
        await query('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES (NULL,$1,$2,$3,$4,now())',
          [subject, recipients.join('; '), r.ok ? '成功' : '失败', r.ok ? '' : r.message]);
        if (r.ok) await query('UPDATE fee_periods SET notified_at = now() WHERE id = $1', [id]);
        return r.ok ? ok({ ...r, count: recipients.length }) : fail(r.message);
      }
      break;
    }

    /* ---- 邮件 ---- */
    case 'email': {
      if (seg.length === 2 && seg[1] === 'send' && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const to = Array.isArray(b.to) ? b.to : String(b.to || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
        if (!to.length) return fail('收件人为空');
        if (!b.subject) return fail('主题不能为空');
        const r = await sendMail(await getSmtpConfig(), { to, subject: b.subject, text: b.text, html: b.html });
        await query('INSERT INTO email_log (activity_id, subject, to_list, status, error, sent_at) VALUES (NULL,$1,$2,$3,$4,now())',
          [b.subject, to.join('; '), r.ok ? '成功' : '失败', r.ok ? '' : r.message]);
        return r.ok ? ok(r) : fail(r.message);
      }
      if (seg.length === 2 && seg[1] === 'test' && method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const to = b.to || (await getSetting('smtp_from')) || (await getSetting('smtp_user'));
        if (!to) return fail('请先填写收件邮箱或 SMTP 账号');
        const orgName = await getSetting('org_name');
        const r = await sendMail(await getSmtpConfig(), { to: [to], subject: '【测试邮件】' + orgName + ' 邮件功能正常', html: `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;padding:20px;">这是一封来自「${escapeHtml(orgName)}」团支部管理平台的测试邮件，表示 SMTP 邮件配置成功。</div>` });
        return r.ok ? ok(r) : fail(r.message);
      }
      if (seg.length === 2 && seg[1] === 'logs' && method === 'GET') {
        const logs = await query('SELECT * FROM email_log ORDER BY id DESC LIMIT 100');
        return ok({ logs });
      }
      break;
    }

    /* ---- 智慧团建 ---- */
    case 'zhtj': {
      if (seg.length === 2 && seg[1] === 'routes' && method === 'GET') {
        return ok({ base_url: await getSetting('zhtj_base_url'), routes: await getJSONSetting('zhtj_routes', []) });
      }
      break;
    }

    /* ---- AI 测试 ---- */
    case 'ai': {
      if (seg.length === 2 && seg[1] === 'test' && method === 'POST') {
        try {
          const cfg = ai.getAIConfig(await getAISettings());
          const reply = await ai.chatCompletion(cfg, [{ role: 'user', content: '请只回复两个字：正常' }]);
          return ok({ ok: true, message: 'AI 连接正常，模型回复：' + (reply || '').slice(0, 40) });
        } catch (e) { return fail('AI 连接失败：' + e.message); }
      }
      break;
    }

    /* ---- 设置 ---- */
    case 'settings': {
      if (method === 'GET') {
        const smtpPass = await getSetting('smtp_pass');
        const aiKey = await getSetting('ai_api_key');
        return ok({
          site_name: await getSetting('site_name'), org_name: await getSetting('org_name'),
          smtp_host: await getSetting('smtp_host'), smtp_port: await getSetting('smtp_port'), smtp_secure: await getSetting('smtp_secure'),
          smtp_user: await getSetting('smtp_user'), smtp_from: await getSetting('smtp_from'), smtp_from_name: await getSetting('smtp_from_name'),
          smtp_pass_set: !!smtpPass,
          ai_provider: await getSetting('ai_provider'), ai_base_url: await getSetting('ai_base_url'), ai_model: await getSetting('ai_model'), ai_temperature: await getSetting('ai_temperature'),
          ai_api_key_set: !!aiKey,
          zhtj_base_url: await getSetting('zhtj_base_url'), zhtj_routes: await getJSONSetting('zhtj_routes', []),
        });
      }
      if (method === 'PUT') {
        const b = await req.json().catch(() => ({}));
        for (const k of ['site_name', 'org_name', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from', 'smtp_from_name', 'ai_provider', 'ai_base_url', 'ai_model', 'ai_temperature', 'zhtj_base_url']) {
          if (b[k] !== undefined) await setSetting(k, b[k]);
        }
        if (b.smtp_pass === '__CLEAR__') await setSetting('smtp_pass', '');
        else if (b.smtp_pass) await setSetting('smtp_pass', b.smtp_pass);
        if (b.ai_api_key === '__CLEAR__') await setSetting('ai_api_key', '');
        else if (b.ai_api_key) await setSetting('ai_api_key', b.ai_api_key);
        if (Array.isArray(b.zhtj_routes)) await setSetting('zhtj_routes', JSON.stringify(b.zhtj_routes));
        return ok({ ok: true });
      }
      break;
    }
  }
  return fail('接口不存在', 404);
}

/* ---- 公开内容：信息发布 ---- */
async function handlePosts(req, seg, method) {
  const id = seg.length > 1 && /^\d+$/.test(seg[1]) ? Number(seg[1]) : null;
  const admin = await requireAdmin(req);

  // 公开列表：匿名只看已发布；管理员看全部（可用 ?status=）
  if (seg.length === 1 && method === 'GET') {
    const u = new URL(req.url);
    if (admin) {
      const status = u.searchParams.get('status');
      const rows = status
        ? await query('SELECT * FROM posts WHERE status = $1 ORDER BY is_pinned DESC, published_at DESC NULLS LAST, id DESC', [status])
        : await query('SELECT * FROM posts ORDER BY id DESC');
      return ok({ posts: rows });
    }
    const rows = await query(`SELECT id, title, category, cover_url, is_pinned, published_at FROM posts WHERE status = 'published' ORDER BY is_pinned DESC, published_at DESC NULLS LAST, id DESC`);
    return ok({ posts: rows });
  }

  // 公开详情
  if (seg.length === 2 && method === 'GET' && id) {
    const post = await queryOne('SELECT * FROM posts WHERE id = $1', [id]);
    if (!post) return fail('内容不存在', 404);
    if (post.status !== 'published' && !admin) return fail('内容未发布', 404);
    return ok({ post });
  }

  if (!admin) return fail('未登录或权限不足', 401);

  if (seg.length === 1 && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!b.title) return fail('标题不能为空');
    const r = await queryOne(`INSERT INTO posts (title, content, category, cover_url, is_pinned, status) VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
      [b.title, b.content || '', b.category || '通知', b.cover_url || '', !!b.is_pinned]);
    return ok({ id: r.id });
  }
  if (seg.length === 2 && method === 'PUT' && id) {
    const b = await req.json().catch(() => ({}));
    await query('UPDATE posts SET title=$1, content=$2, category=$3, cover_url=$4, is_pinned=$5, updated_at=now() WHERE id=$6',
      [b.title, b.content || '', b.category || '通知', b.cover_url || '', !!b.is_pinned, id]);
    return ok({ ok: true });
  }
  if (seg.length === 2 && method === 'DELETE' && id) {
    await query('DELETE FROM posts WHERE id = $1', [id]);
    return ok({ ok: true });
  }
  if (seg.length === 3 && (seg[2] === 'publish' || seg[2] === 'unpublish') && method === 'POST' && id) {
    const pub = seg[2] === 'publish';
    await query(`UPDATE posts SET status = $1, published_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $3`, [pub ? 'published' : 'draft', pub, id]);
    return ok({ ok: true });
  }
  return fail('接口不存在', 404);
}

/* ---- 公开内容：投票 ---- */
function pollEffectiveStatus(p) {
  if (p.status === 'draft') return 'draft';
  if (p.status === 'closed') return 'closed';
  const nowT = Date.now();
  if (p.end_at && new Date(p.end_at).getTime() < nowT) return 'closed';
  if (p.start_at && new Date(p.start_at).getTime() > nowT) return 'upcoming';
  return 'open';
}

async function pollWithOptions(id) {
  const poll = await queryOne('SELECT * FROM polls WHERE id = $1', [id]);
  if (!poll) return null;
  const options = await query('SELECT * FROM poll_options WHERE poll_id = $1 ORDER BY sort_order, id', [id]);
  poll.options = options;
  poll.effective_status = pollEffectiveStatus(poll);
  return poll;
}

async function pollResults(pollId) {
  const tally = await query('SELECT option_id, COUNT(*) c FROM poll_votes WHERE poll_id = $1 GROUP BY option_id', [pollId]);
  const participants = Number((await queryOne('SELECT COUNT(DISTINCT member_id) c FROM poll_votes WHERE poll_id = $1', [pollId])).c);
  const eligible = Number((await queryOne(`SELECT COUNT(*) c FROM members WHERE political_status != '群众' OR political_status = ''`)).c);
  const counts = {};
  for (const t of tally) counts[t.option_id] = Number(t.c);
  return { counts, participants, total_eligible: eligible, rate: eligible ? Math.round((participants / eligible) * 1000) / 10 : 0 };
}

async function handlePolls(req, seg, method) {
  const id = seg.length > 1 && /^\d+$/.test(seg[1]) ? Number(seg[1]) : null;
  const admin = await requireAdmin(req);
  const member = await requireMember(req);
  const principal = admin ? { type: 'admin' } : member ? { type: 'member', member } : { type: 'anon' };

  // 公开列表：匿名只看已发布
  if (seg.length === 1 && method === 'GET') {
    const rows = admin
      ? await query('SELECT * FROM polls ORDER BY id DESC')
      : await query(`SELECT * FROM polls WHERE status != 'draft' ORDER BY published_at DESC NULLS LAST, id DESC`);
    const out = [];
    for (const p of rows) {
      p.effective_status = pollEffectiveStatus(p);
      out.push(p);
    }
    return ok({ polls: out });
  }

  // 详情（含选项；结果按可见性附带）
  if (seg.length === 2 && method === 'GET' && id) {
    const poll = await pollWithOptions(id);
    if (!poll) return fail('投票不存在', 404);
    if (poll.status === 'draft' && !admin) return fail('投票未发布', 404);
    const results = await pollResults(id);
    const visible = admin
      || poll.result_visibility === 'always'
      || (poll.result_visibility === 'after_end' && poll.effective_status === 'closed');
    const resp = { poll, participants: results.participants, total_eligible: results.total_eligible, rate: results.rate };
    if (visible) resp.counts = results.counts;
    if (member) {
      const my = await query('SELECT option_id FROM poll_votes WHERE poll_id = $1 AND member_id = $2', [id, member.id]);
      resp.has_voted = my.length > 0;
      resp.my_option_ids = my.map((r) => r.option_id);
    }
    return ok(resp);
  }

  // 投票（需团员身份）
  if (seg.length === 3 && seg[2] === 'vote' && method === 'POST' && id) {
    if (!member) return fail('请先以姓名+学号登录后再投票', 401);
    const poll = await pollWithOptions(id);
    if (!poll) return fail('投票不存在', 404);
    if (poll.effective_status !== 'open') return fail('投票未开放或已结束');
    const b = await req.json().catch(() => ({}));
    let ids = Array.isArray(b.option_ids) ? b.option_ids.map(Number) : [Number(b.option_ids)];
    ids = ids.filter((x) => Number.isInteger(x) && poll.options.some((o) => o.id === x));
    if (!ids.length) return fail('请选择有效选项');
    if (poll.poll_type === 'single' && ids.length !== 1) return fail('单选投票只能选择一个选项');
    const max = poll.poll_type === 'multiple' ? (poll.multi_max || 1) : 1;
    if (ids.length > max) return fail(`最多选择 ${max} 个选项`);

    const voted = Number((await queryOne('SELECT COUNT(*) c FROM poll_votes WHERE poll_id = $1 AND member_id = $2', [id, member.id])).c);
    if (voted > 0 && !poll.allow_change_vote) return fail('您已参与过本次投票');
    if (voted > 0) {
      // 防刷：改票需间隔至少 5 秒
      const last = await queryOne('SELECT created_at FROM poll_votes WHERE poll_id = $1 AND member_id = $2 ORDER BY created_at DESC LIMIT 1', [id, member.id]);
      if (last && Date.now() - new Date(last.created_at).getTime() < 5000) return fail('操作过于频繁，请稍后再试');
      await query('DELETE FROM poll_votes WHERE poll_id = $1 AND member_id = $2', [id, member.id]);
    }
    for (const oid of ids) {
      await query('INSERT INTO poll_votes (poll_id, option_id, member_id) VALUES ($1,$2,$3)', [id, oid, member.id]);
    }
    return ok({ ok: true });
  }

  // 导出投票结果 CSV（管理员）
  if (seg.length === 3 && seg[2] === 'export' && method === 'GET' && id) {
    if (!admin) return fail('未登录或权限不足', 401);
    const poll = await pollWithOptions(id);
    if (!poll) return fail('投票不存在', 404);
    const results = await pollResults(id);
    const optMap = {};
    for (const o of poll.options) optMap[o.id] = o.text;
    const lines = [];
    if (poll.is_anonymous) {
      lines.push('选项,票数,占比');
      for (const o of poll.options) {
        const c = results.counts[o.id] || 0;
        const pct = results.participants ? Math.round((c / results.participants) * 1000) / 10 : 0;
        lines.push(`${csvEscape(o.text)},${c},${pct}%`);
      }
      lines.push(`合计,${results.participants},参与率 ${results.rate}%`);
    } else {
      lines.push('选项,投票人,学号,投票时间');
      const rows = await query(`SELECT pv.option_id, pv.created_at, m.name, m.student_no FROM poll_votes pv JOIN members m ON m.id = pv.member_id WHERE pv.poll_id = $1 ORDER BY pv.option_id, pv.created_at`, [id]);
      for (const r of rows) {
        lines.push(`${csvEscape(optMap[r.option_id] || '')},${csvEscape(r.name)},${csvEscape(r.student_no)},${csvEscape(String(r.created_at))}`);
      }
      lines.push(`合计,${results.participants},,参与率 ${results.rate}%`);
    }
    const csv = '\uFEFF' + lines.join('\r\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="poll-${id}-result.csv"` } });
  }

  // 结果（管理员或按可见性）
  if (seg.length === 3 && seg[2] === 'results' && method === 'GET' && id) {
    const poll = await pollWithOptions(id);
    if (!poll) return fail('投票不存在', 404);
    if (!admin && poll.status === 'draft') return fail('投票未发布', 404);
    const results = await pollResults(id);
    const visible = admin || poll.result_visibility === 'always' || (poll.result_visibility === 'after_end' && poll.effective_status === 'closed');
    if (!visible) return fail('结果暂不可见');
    const out = { poll, participants: results.participants, total_eligible: results.total_eligible, rate: results.rate, counts: results.counts };
    // 实名投票 + 管理员：附带每个选项的投票人
    if (admin && !poll.is_anonymous) {
      const rows = await query(`SELECT pv.option_id, m.name, m.student_no FROM poll_votes pv JOIN members m ON m.id = pv.member_id WHERE pv.poll_id = $1 ORDER BY pv.option_id, m.id`, [id]);
      out.voters = rows;
    }
    return ok(out);
  }

  if (!admin) return fail('未登录或权限不足', 401);

  if (seg.length === 1 && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!b.title) return fail('标题不能为空');
    const r = await queryOne(`INSERT INTO polls (title, description, poll_type, multi_max, is_anonymous, result_visibility, allow_change_vote, start_at, end_at, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING id`,
      [b.title, b.description || '', b.poll_type || 'single', b.poll_type === 'multiple' ? (Number(b.multi_max) || 1) : 1, !!b.is_anonymous, b.result_visibility || 'always', !!b.allow_change_vote, b.start_at || null, b.end_at || null, admin.id]);
    const options = Array.isArray(b.options) ? b.options : [];
    for (let i = 0; i < options.length; i++) {
      if (String(options[i].text || '').trim()) {
        await query('INSERT INTO poll_options (poll_id, text, sort_order) VALUES ($1,$2,$3)', [r.id, String(options[i].text).trim(), i]);
      }
    }
    return ok({ id: r.id });
  }
  if (seg.length === 2 && method === 'PUT' && id) {
    const b = await req.json().catch(() => ({}));
    await query(`UPDATE polls SET title=$1, description=$2, poll_type=$3, multi_max=$4, is_anonymous=$5, result_visibility=$6, allow_change_vote=$7, start_at=$8, end_at=$9, updated_at=now() WHERE id=$10`,
      [b.title, b.description || '', b.poll_type || 'single', b.poll_type === 'multiple' ? (Number(b.multi_max) || 1) : 1, !!b.is_anonymous, b.result_visibility || 'always', !!b.allow_change_vote, b.start_at || null, b.end_at || null, id]);
    // 尚无投票时才允许替换选项
    const voted = Number((await queryOne('SELECT COUNT(*) c FROM poll_votes WHERE poll_id = $1', [id])).c);
    if (voted === 0 && Array.isArray(b.options)) {
      await query('DELETE FROM poll_options WHERE poll_id = $1', [id]);
      for (let i = 0; i < b.options.length; i++) {
        if (String(b.options[i].text || '').trim()) {
          await query('INSERT INTO poll_options (poll_id, text, sort_order) VALUES ($1,$2,$3)', [id, String(b.options[i].text).trim(), i]);
        }
      }
    }
    return ok({ ok: true });
  }
  if (seg.length === 2 && method === 'DELETE' && id) {
    await query('DELETE FROM polls WHERE id = $1', [id]);
    return ok({ ok: true });
  }
  if (seg.length === 3 && (seg[2] === 'publish' || seg[2] === 'unpublish' || seg[2] === 'close') && method === 'POST' && id) {
    let status;
    if (seg[2] === 'publish') status = 'published';
    else if (seg[2] === 'close') status = 'closed';
    else status = 'draft';
    await query(`UPDATE polls SET status = $1, published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END, updated_at = now() WHERE id = $3`, [status, status, id]);
    return ok({ ok: true });
  }
  return fail('接口不存在', 404);
}
