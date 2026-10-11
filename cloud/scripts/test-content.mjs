import '../lib/load-env.js';
import { query } from '../lib/db.js';

const BASE = 'http://127.0.0.1:3000';
let pass = 0, failCount = 0;
function check(name, cond) { if (cond) { pass++; console.log('✓ ' + name); } else { failCount++; console.log('✗ ' + name); } }

async function main() {
  // 管理员登录
  const al = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jiangdzh2026@shanghaitech.edu.cn', password: 'admin123' }) });
  const adminCk = al.headers.get('set-cookie')?.split(';')[0] || '';
  const H = (ck) => ({ 'Content-Type': 'application/json', Cookie: ck });

  // 造两个团员
  const mk = async (name, no) => (await (await fetch(BASE + '/api/members', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ name, student_no: no, volunteer_willing: 1 }) })).json()).member;
  const m1 = await mk('投票甲', 'T' + Date.now() + 'A');
  const m2 = await mk('投票乙', 'T' + Date.now() + 'B');

  // 团员登录
  const ml1 = await fetch(BASE + '/api/auth/member-login', { method: 'POST', headers: H(''), body: JSON.stringify({ name: m1.name, student_no: m1.student_no }) });
  const ck1 = ml1.headers.get('set-cookie')?.split(';')[0] || '';
  const ml2 = await fetch(BASE + '/api/auth/member-login', { method: 'POST', headers: H(''), body: JSON.stringify({ name: m2.name, student_no: m2.student_no }) });
  const ck2 = ml2.headers.get('set-cookie')?.split(';')[0] || '';

  /* ---- 信息发布 ---- */
  const p = await (await fetch(BASE + '/api/posts', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ title: '测试公告', content: '内容正文', category: '通知', is_pinned: true }) })).json();
  check('创建信息发布', !!p.id);
  let pubList = await (await fetch(BASE + '/api/posts')).json();
  check('未发布时公开列表为空', !pubList.posts.some((x) => x.id === p.id));
  await fetch(BASE + `/api/posts/${p.id}/publish`, { method: 'POST', headers: H(adminCk) });
  pubList = await (await fetch(BASE + '/api/posts')).json();
  check('发布后公开可见', pubList.posts.some((x) => x.id === p.id));
  const pubDetail = await (await fetch(BASE + `/api/posts/${p.id}`)).json();
  check('公开详情可匿名访问', pubDetail.post?.title === '测试公告');

  /* ---- 投票 ---- */
  const poll = await (await fetch(BASE + '/api/polls', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ title: '最喜欢的活动', poll_type: 'single', is_anonymous: true, result_visibility: 'always', options: [{ text: '篮球' }, { text: '读书' }, { text: '摄影' }] }) })).json();
  check('创建投票', !!poll.id);
  await fetch(BASE + `/api/polls/${poll.id}/publish`, { method: 'POST', headers: H(adminCk) });

  // 未登录投票应被拒
  const anonVote = await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(''), body: JSON.stringify({ option_ids: [1] }) });
  check('未登录投票被拒', anonVote.status === 401);

  // 团员投票
  const pollDetail = await (await fetch(BASE + `/api/polls/${poll.id}`, { headers: H(adminCk) })).json();
  const optId = pollDetail.poll.options[0].id;
  const v1 = await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [optId] }) });
  check('团员投票成功', v1.status === 200);
  const v2 = await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(ck2), body: JSON.stringify({ option_ids: [pollDetail.poll.options[1].id] }) });
  check('第二名团员投票成功', v2.status === 200);
  const dup = await fetch(BASE + `/api/polls/${poll.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [optId] }) });
  check('重复投票被拒', dup.status === 400);

  // 结果
  const res = await (await fetch(BASE + `/api/polls/${poll.id}/results`, { headers: H('') })).json();
  check('结果实时可见（always）', res.counts && res.participants === 2 && Object.values(res.counts).reduce((a, b) => a + b, 0) === 2);

  /* ---- 多选投票 + 实名 ---- */
  const mp = await (await fetch(BASE + '/api/polls', { method: 'POST', headers: H(adminCk), body: JSON.stringify({ title: '多选测试', poll_type: 'multiple', multi_max: 2, is_anonymous: false, result_visibility: 'after_end', options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] }) })).json();
  await fetch(BASE + `/api/polls/${mp.id}/publish`, { method: 'POST', headers: H(adminCk) });
  const mpDetail = await (await fetch(BASE + `/api/polls/${mp.id}`, { headers: H(adminCk) })).json();
  const opts = mpDetail.poll.options.map((o) => o.id);
  const mv = await fetch(BASE + `/api/polls/${mp.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [opts[0], opts[1]] }) });
  check('多选投票成功（选2项）', mv.status === 200);
  const mv2 = await fetch(BASE + `/api/polls/${mp.id}/vote`, { method: 'POST', headers: H(ck1), body: JSON.stringify({ option_ids: [opts[0], opts[1], opts[2]] }) });
  check('超过多选上限被拒', mv2.status === 400);
  const resAfter = await (await fetch(BASE + `/api/polls/${mp.id}/results`, { headers: H('') })).json();
  check('结束后才可见（进行中匿名看不到）', !resAfter.counts);
  const resAdmin = await (await fetch(BASE + `/api/polls/${mp.id}/results`, { headers: H(adminCk) })).json();
  check('管理员可见实名投票人', resAdmin.voters && resAdmin.voters.length === 2 && resAdmin.voters[0].name === m1.name);

  // 清理
  await query('DELETE FROM posts WHERE id = $1', [p.id]);
  await query('DELETE FROM polls WHERE id = ANY($1::int[])', [[poll.id, mp.id]]);
  await query('DELETE FROM members WHERE id = ANY($1::int[])', [[m1.id, m2.id]]);

  console.log(`\n通过 ${pass} 项，失败 ${failCount} 项`);
  process.exit(failCount ? 1 : 0);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
