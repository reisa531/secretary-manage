import '../lib/load-env.js';
import { query } from '../lib/db.js';

const BASE = 'http://127.0.0.1:3000';
let pass = 0, failCount = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { failCount++; console.log('✗ ' + name); }
}

async function main() {
  // 1. ready
  const r = await (await fetch(BASE + '/api/ready')).json();
  check('ready 接口', r.ok === true && r.service === 'secretary-manage-cloud');

  // 2. 管理员登录（迁移后的账号）
  const adminLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jiangdzh2026@shanghaitech.edu.cn', password: 'admin123' }) });
  const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0] || '';
  check('管理员登录', adminLogin.status === 200);

  // 3. 管理员创建一名团员
  const studentNo = 'S' + Date.now();
  const mk = await fetch(BASE + '/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ name: '投票测试员', gender: '男', student_no: studentNo, major: '计算机', volunteer_willing: 1 }) });
  const mkJ = await mk.json();
  check('管理员创建成员', mk.status === 200 && mkJ.member?.student_no === studentNo);
  const mid = mkJ.member.id;

  // 4. 团员用「姓名 + 学号」登录
  const ml = await fetch(BASE + '/api/auth/member-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '投票测试员', student_no: studentNo }) });
  const memberCookie = ml.headers.get('set-cookie')?.split(';')[0] || '';
  check('团员姓名+学号登录', ml.status === 200);

  // 5. 错误的学号应被拒绝
  const bad = await fetch(BASE + '/api/auth/member-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '投票测试员', student_no: 'WRONG' }) });
  check('学号错误被拒', bad.status === 401);

  // 6. me（团员）
  const me = await (await fetch(BASE + '/api/auth/me', { headers: { Cookie: memberCookie } })).json();
  check('me 返回团员身份', me.type === 'member' && me.member?.name === '投票测试员');

  // 7. 团员访问管理接口应 401
  const denied = await fetch(BASE + '/api/members', { headers: { Cookie: memberCookie } });
  check('团员访问管理接口被拒', denied.status === 401);

  // 8. 管理员正常访问
  const list = await (await fetch(BASE + '/api/members', { headers: { Cookie: adminCookie } })).json();
  check('成员列表', list.members?.some((m) => m.id === mid));

  const dash = await (await fetch(BASE + '/api/dashboard', { headers: { Cookie: adminCookie } })).json();
  check('仪表盘', typeof dash.total === 'number');

  const bs = await (await fetch(BASE + '/api/branch-stats', { headers: { Cookie: adminCookie } })).json();
  check('数字画像', Array.isArray(bs.stats?.hobbies));

  // 清理测试成员
  await query('DELETE FROM members WHERE id = $1', [mid]);

  console.log(`\n通过 ${pass} 项，失败 ${failCount} 项`);
  process.exit(failCount ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
