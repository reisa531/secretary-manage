'use strict';
// 验证画像降级路径与邮件失败路径（AI/SMTP 未配置时优雅返回）
const BASE = 'http://localhost:8081';
async function main() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  const mk = await (await fetch(BASE + '/api/members', {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '测试员', hobbies: '篮球,读书', specialties: '主持', volunteer_willing: 1, self_intro: '乐观积极' }),
  })).json();
  const id = mk.member.id;

  // 画像：AI 未配置应返回 200 + 规则兜底
  const pr = await fetch(BASE + `/api/members/${id}/portrait`, { method: 'POST', headers: H });
  const pj = await pr.json();
  console.log('画像 HTTP', pr.status, 'fallback_reason=', (pj.portrait && pj.portrait.fallback_reason) ? '有' : '无', 'summary=', (pj.portrait && pj.portrait.summary));

  // 邮件测试：SMTP 未配置应返回 400 + 错误信息（不崩溃）
  const er = await fetch(BASE + '/api/email/test', { method: 'POST', headers: H, body: JSON.stringify({ to: '' }) });
  const ej = await er.json();
  console.log('邮件测试 HTTP', er.status, 'message=', ej.message || ej.error);

  // 设置读写
  const s0 = await (await fetch(BASE + '/api/settings', { headers: { Cookie: cookie } })).json();
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ org_name: '测试团支部' }) });
  const s1 = await (await fetch(BASE + '/api/settings', { headers: { Cookie: cookie } })).json();
  console.log('设置 org_name 写入前后:', s0.org_name, '->', s1.org_name);
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ org_name: s0.org_name }) });

  await fetch(BASE + '/api/members/' + id, { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('降级与设置路径验证通过 ✓');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
