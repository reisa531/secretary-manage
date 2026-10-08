'use strict';
// 验证打包后的应用（dist/win-unpacked）中 server + node:sqlite 能正常启动并响应
const os = require('node:os');
const path = require('node:path');
process.env.SECRETARY_DATA_DIR = path.join(os.tmpdir(), 'secretary-electron-test-' + Date.now());
process.env.HOST = '127.0.0.1';

const { server } = require('../dist/win-unpacked/resources/app/server.js');

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const r = await fetch('http://127.0.0.1:' + port + '/api/health');
    const j = await r.json();
    console.log('packaged server health: HTTP', r.status, JSON.stringify(j));
    console.log(j.ok && j.service === 'secretary-manage' ? '打包后服务启动验证通过 ✓' : '验证失败 ✗');
    process.exit(j.ok ? 0 : 1);
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  }
});
