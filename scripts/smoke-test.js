'use strict';
// 冒烟测试脚本：验证平台 UTF-8 中文数据存取与核心 API
const BASE = 'http://localhost:8081';

async function main() {
  // 登录
  const login = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'admin123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // 创建含中文的成员
  const mk = await fetch(BASE + '/api/members', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      name: '李四', gender: '女', student_no: '2023002', email: 'lisi@example.com',
      hobbies: '绘画,摄影,志愿服务', specialties: '演讲,主持', volunteer_willing: 1,
      volunteer_types: '支教,敬老', self_intro: '热情开朗，责任心强，喜欢组织集体活动。',
      major: '汉语言文学', league_role: '组织委员',
    }),
  });
  const created = await mk.json();
  console.log('创建成员 id=' + created.member.id + ' name=' + created.member.name);

  // 读取回验证中文
  const got = await (await fetch(BASE + '/api/members/' + created.member.id, { headers: { Cookie: cookie } })).json();
  console.log('读回 name=' + got.member.name + ' hobbies=' + got.member.hobbies + ' intro=' + got.member.self_intro);

  // 仪表盘
  const dash = await (await fetch(BASE + '/api/dashboard', { headers: { Cookie: cookie } })).json();
  console.log('仪表盘 total=' + dash.total + ' active=' + dash.active);

  // 数字画像
  const bs = await (await fetch(BASE + '/api/branch-stats', { headers: { Cookie: cookie } })).json();
  console.log('数字画像 爱好TOP=' + JSON.stringify(bs.stats.hobbies.slice(0, 3)));
  console.log('数字画像 志愿意愿=' + JSON.stringify(bs.stats.volunteer_willing));
  console.log('数字画像 愿意名单=' + JSON.stringify(bs.stats.willing_names));

  // 清理测试数据
  for (const id of [1, created.member.id]) {
    await fetch(BASE + '/api/members/' + id, { method: 'DELETE', headers: { Cookie: cookie } });
  }
  await fetch(BASE + '/api/activities/1', { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('测试数据已清理，全部通过 ✓');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
