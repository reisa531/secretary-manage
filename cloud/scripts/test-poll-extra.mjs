import '../lib/load-env.js';
import { query } from '../lib/db.js';

const BASE = 'http://127.0.0.1:3000';
let pass = 0, failCount = 0;
function check(name, cond) { if (cond) { pass++; console.log('✓ ' + name); } else { failCount++; console.log('✗ ' + name); } }

async function main() {
  const al = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jiangdzh2026@shanghaitech.edu.cn', password: 'admin123' }) });
  const adminCk = al.headers.get('set-cookie')?.split(';')[0] || '';
  const H = (ck) => ({ 'Content-Type': 'application/json', Cookie: ck });

  // 造两名团员（1 名群众排除在外）
  const mk = async (name, no, ps) => (await (await fetch(BASE + '/api/members', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ name, student_no: no, political_status: ps || '共青团员' }) })).json()).member;
  const m1 = await mk('费率甲', 'R' + Date.now() + 'A');
  const m2 = await mk('费率乙', 'R' + Date.now() + 'B', '群众');

  const ml = await fetch(BASE + '/api/auth/member-login', { method: 'POST', headers: H(''), body: JSON.stringify({ name: m1.name, student_no: m1.student_no }) });
  const ck1 = ml.headers.get('set-cookie')?.split(';')[0] || '';

  const poll = await (await fetch(BASE + '/api/polls', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ title: '费率测试', poll_type: 'single', is_anonymous: false, result_visibility: 'always', options: [{ text: 'A' }, { text: 'B' }] }) })).json();
  await fetch(BASE + `/api/polls/${poll.id}/publish`, { method: 'POST', headers: H(adminCk) });
  const pd = await (await fetch(BASE + `/api/polls/${poll.id}`, { headers: H(adminCk) })).json();
  const opt = pd.poll.options[0].id;
  await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [opt] }) });

  // 投票率：参与人数 / 数据库合格人数（群众不算）
  const eligible = Number((await query(`SELECT COUNT(*) c FROM members WHERE political_status != '群众' OR political_status = ''`))[0].c);
  const res = await (await fetch(BASE + `/api/polls/${poll.id}/results`, { headers: H(adminCk) })).json();
  check('总合格人数=数据库合格数（群众排除）', res.total_eligible === eligible && eligible >= 1);
  check('参与率公式正确', res.rate === Math.round((res.participants / eligible) * 1000) / 10);

  // CSV 导出
  const csv = await fetch(BASE + `/api/polls/${poll.id}/export`, { headers: H(adminCk) });
  const text = await csv.text();
  check('CSV 导出（含投票人）', csv.status === 200 && text.includes('选项,投票人,学号') && text.includes(m1.name) && text.includes('参与率'));

  // 改票节流：5 秒内再次投票应被拒
  const throttle = await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [opt] }) });
  check('改票节流（5秒内被拒）', throttle.status === 400);

  await query('DELETE FROM polls WHERE id = $1', [poll.id]);
  await query('DELETE FROM members WHERE id = ANY($1::int[])', [[m1.id, m2.id]]);

  console.log(`\n通过 ${pass} 项，失败 ${failCount} 项`);
  process.exit(failCount ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
