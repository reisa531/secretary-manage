'use strict';
// 同步智慧团建路由表到运行中的实例（走 API，同时验证设置写入路径）
const BASE = 'http://localhost:8081';
const ROUTES = [
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
];

async function main() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  const put = await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({ zhtj_routes: ROUTES }) });
  console.log('写入路由表 HTTP', put.status);

  const got = await (await fetch(BASE + '/api/zhtj/routes', { headers: { Cookie: cookie } })).json();
  console.log('读回路由条数:', got.routes.length);
  for (const r of got.routes) console.log('  -', r.name, '=>', r.url);
  console.log(got.routes.length === ROUTES.length ? '智慧团建路由表同步成功 ✓' : '同步失败 ✗');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
