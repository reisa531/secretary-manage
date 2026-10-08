'use strict';
// 用本地模拟 SMTP 服务器验证 smtp.js 协议实现（EHLO/MAIL/RCPT/DATA/QUIT）
const net = require('node:net');
const { SMTPClient } = require('../lib/smtp');

const received = [];   // 记录全部命令
const body = [];       // 记录 DATA 正文
const server = net.createServer((socket) => {
  socket.write('220 mock.example.com ESMTP ready\r\n');
  let dataMode = false;
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (dataMode) {
        if (line === '.') { dataMode = false; socket.write('250 OK queued\r\n'); }
        else body.push(line);
        continue;
      }
      received.push(line);
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-mock.example.com\r\n250 AUTH LOGIN PLAIN\r\n');
      else if (cmd === 'MAIL') socket.write('250 OK\r\n');
      else if (cmd === 'RCPT') socket.write('250 OK\r\n');
      else if (cmd === 'DATA') { dataMode = true; socket.write('354 End with <CR><LF>.<CR><LF>\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const client = new SMTPClient({ host: '127.0.0.1', port, secure: 0, from: 'sender@test.com', fromName: '团支部' });
  try {
    await client.send({ to: ['a@test.com', 'b@test.com'], subject: '测试活动通知', text: '大家好', html: '<p>大家好</p>' });
    const all = received.join('\r\n') + '\r\n' + body.join('\r\n');
    const checks = [
      ['EHLO', received.some((l) => l.startsWith('EHLO '))],
      ['MAIL FROM', all.includes('MAIL FROM:<sender@test.com>')],
      ['RCPT x2', all.includes('RCPT TO:<a@test.com>') && all.includes('RCPT TO:<b@test.com>')],
      ['DATA 命令', received.some((l) => l === 'DATA')],
      ['Subject 编码', all.includes('Subject: =?UTF-8?B?')],
      ['From 名称', all.includes('"团支部" <sender@test.com>')],
      ['HTML Content-Type', all.includes('text/html; charset=UTF-8')],
      ['QUIT', received.some((l) => l === 'QUIT')],
    ];
    let ok = true;
    for (const [name, pass] of checks) { console.log((pass ? '✓' : '✗') + ' ' + name); if (!pass) ok = false; }
    console.log(ok ? 'SMTP 协议实现验证通过 ✓' : 'SMTP 协议实现存在问题 ✗');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error('SMTP 发送失败:', e.message);
    process.exitCode = 1;
  } finally {
    client.close(); server.close();
  }
});
