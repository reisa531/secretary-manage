'use strict';
// 验证 SMTPS(465 隐式 TLS) 连接 + 问候 + EHLO 解析修复（不发送任何凭据或邮件）
const { SMTPClient } = require('../lib/smtp');

async function main() {
  const c = new SMTPClient({ host: 'smtp.shanghaitech.edu.cn', port: 465, secure: 1, from: 'jiangdzh2026@shanghaitech.edu.cn' });
  try {
    await c._connect();
    const greeting = await c._readResponse();
    console.log('问候:', greeting.code, greeting.lines.join(' '));
    const hello = await c._command('EHLO smtp.shanghaitech.edu.cn', '2');
    console.log('EHLO 解析能力数:', hello.lines.length);
    console.log('  AUTH 行:', hello.lines.filter((l) => /AUTH/i.test(l)).join(' | '));
    console.log('  STARTTLS:', hello.lines.some((l) => /STARTTLS/i.test(l)));
    await c._command('QUIT', '2').catch(() => {});
    console.log((greeting.code.startsWith('2') && hello.lines.length > 0) ? 'SMTPS 握手解析验证通过 ✓' : '握手异常 ✗');
    if (!(greeting.code.startsWith('2') && hello.lines.length > 0)) process.exitCode = 1;
  } catch (e) {
    console.error('FAIL:', e.message);
    process.exitCode = 1;
  } finally {
    c.close();
  }
}
main();
