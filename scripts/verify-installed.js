'use strict';
// 验证已安装桌面版的 server + 迁移后的数据库能正常服务
const os = require('node:os');
const path = require('node:path');

process.env.SECRETARY_DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'secretary-manage', 'data');
process.env.HOST = '127.0.0.1';

const { server } = require('E:/Program Files/secretary-manage/resources/app/server.js');

server.listen(0, '127.0.0.1', async () => {
  try {
    const base = 'http://127.0.0.1:' + server.address().port;

    // 健康检查
    const h = await fetch(base + '/api/health');
    const hj = await h.json();

    // 登录
    const login = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';

    // 成员数
    const members = await (await fetch(base + '/api/members', { headers: { Cookie: cookie } })).json();

    console.log('健康检查:', h.status, JSON.stringify(hj));
    console.log('登录:', login.status, login.ok ? '成功' : '失败');
    console.log('迁移后团员数:', members.members?.length);
    console.log(hj.ok && login.ok && members.members?.length === 1 ? '已安装桌面版 + 迁移数据 验证通过 ✓' : '验证失败 ✗');
    process.exit(hj.ok && login.ok && members.members?.length === 1 ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
});
