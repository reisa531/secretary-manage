'use strict';
// 验证 AUTH LOGIN 认证流程（QQ/163 邮箱常见的 465 端口认证）
const net = require('node:net');
const { SMTPClient } = require('../lib/smtp');

const cmds = [];
const server = net.createServer((socket) => {
  socket.write('220 mock ESMTP\r\n');
  let dataMode = false, stage = 0;
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (dataMode) { if (line === '.') { dataMode = false; socket.write('250 OK\r\n'); } continue; }
      cmds.push(line);
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO') socket.write('250-mock\r\n250 AUTH LOGIN PLAIN\r\n');
      else if (cmd === 'AUTH') {
        if (line === 'AUTH LOGIN') { stage = 1; socket.write('334 VXNlcm5hbWU6\r\n'); }
        else if (line.startsWith('AUTH PLAIN')) { socket.write('235 ok\r\n'); }
        else socket.write('535 bad\r\n');
      } else if (stage === 1) { // 期望 base64 用户名
        socket.write('334 UGFzc3dvcmQ6\r\n'); stage = 2;
      } else if (stage === 2) { // 期望 base64 密码
        socket.write('235 2.7.0 Authentication successful\r\n'); stage = 3;
      } else if (cmd === 'MAIL') socket.write('250 OK\r\n');
      else if (cmd === 'RCPT') socket.write('250 OK\r\n');
      else if (cmd === 'DATA') { dataMode = true; socket.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const client = new SMTPClient({ host: '127.0.0.1', port, secure: 0, user: 'user@qq.com', pass: 'secret123', from: 'user@qq.com' });
  try {
    await client.send({ to: ['x@test.com'], subject: '认证测试', html: '<p>ok</p>' });
    const hasAuth = cmds.some((l) => l === 'AUTH LOGIN');
    const hasUser = cmds.some((l) => l === Buffer.from('user@qq.com').toString('base64'));
    const hasPass = cmds.some((l) => l === Buffer.from('secret123').toString('base64'));
    console.log((hasAuth ? '✓' : '✗') + ' AUTH LOGIN 命令');
    console.log((hasUser ? '✓' : '✗') + ' 用户名 base64 传输');
    console.log((hasPass ? '✓' : '✗') + ' 密码 base64 传输');
    console.log(hasAuth && hasUser && hasPass ? 'AUTH LOGIN 认证流程验证通过 ✓' : '认证流程存在问题 ✗');
    if (!(hasAuth && hasUser && hasPass)) process.exitCode = 1;
  } catch (e) {
    console.error('失败:', e.message);
    process.exitCode = 1;
  } finally { client.close(); server.close(); }
});
