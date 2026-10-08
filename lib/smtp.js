'use strict';
/**
 * 极简 SMTP 客户端（零外部依赖）。
 * 支持：SMTP(25)、SMTP+STARTTLS(587)、SMTPS(465 隐式TLS)、AUTH LOGIN / AUTH PLAIN、匿名中继。
 * 用于"一键发布活动通知"等邮件功能，适配用户提供的任意邮箱（QQ/163/Gmail/企业邮箱等）。
 */
const net = require('node:net');
const tls = require('node:tls');

class SMTPError extends Error {}

class SMTPClient {
  /**
   * @param {object} opts {host, port, secure(0|1), user, pass, from, fromName, timeoutMs}
   */
  constructor(opts) {
    this.host = opts.host;
    this.port = Number(opts.port) || 465;
    this.secure = Number(opts.secure) === 1; // true => SMTPS(隐式TLS)
    this.user = opts.user || '';
    this.pass = opts.pass || '';
    this.from = opts.from || opts.user || '';
    this.fromName = opts.fromName || '';
    this.timeoutMs = opts.timeoutMs || 30000;

    this.socket = null;
    this._buf = '';
    this._pending = null; // {resolve, reject, multiline, code, lines}
  }

  /* ---------- 底层：读写 ---------- */
  _connect() {
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(new SMTPError('连接失败: ' + err.message));
      let s;
      if (this.secure) {
        s = tls.connect({
          host: this.host,
          port: this.port,
          servername: this.host,
          rejectUnauthorized: false,
        });
      } else {
        s = net.connect({ host: this.host, port: this.port });
      }
      this.socket = s;
      s.setTimeout(this.timeoutMs, () => s.destroy(new SMTPError('连接超时')));
      s.once('error', onError);
      const onReady = () => { s.removeListener('error', onError); this._startReader(); resolve(); };
      if (this.secure) s.once('secureConnect', onReady);
      else s.once('connect', onReady);
    });
  }

  _startReader() {
    this.socket.on('data', (chunk) => {
      this._buf += chunk.toString('utf8');
      this._drain();
    });
    this.socket.on('close', () => {
      if (this._pending) {
        this._pending.reject(new SMTPError('连接被服务器关闭'));
        this._pending = null;
      }
    });
  }

  _drain() {
    while (this._pending) {
      const idx = this._buf.indexOf('\r\n');
      if (idx === -1) break;
      const line = this._buf.slice(0, idx);
      this._buf = this._buf.slice(idx + 2);
      const p = this._pending;
      if (line.length >= 3) {
        p.code = line.slice(0, 3);
        p.lines.push(line.slice(4));
        if (line[3] !== '-') {
          this._pending = null;
          p.resolve({ code: p.code, lines: p.lines });
        }
      }
    }
  }

  _readResponse() {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject, code: '', lines: [] };
      this._drain(); // 缓冲区可能已有数据
    });
  }

  _write(cmd) {
    return new Promise((resolve, reject) => {
      this.socket.write(cmd + '\r\n', (err) => (err ? reject(err) : resolve()));
    });
  }

  async _command(cmd, expect = '2', expect3 = '3') {
    await this._write(cmd);
    const res = await this._readResponse();
    if (!res.code.startsWith(expect) && !res.code.startsWith(expect3)) {
      throw new SMTPError(`服务器返回错误 [${res.code}] ${res.lines.join(' ')}`);
    }
    return res;
  }

  _upgradeToTLS() {
    return new Promise((resolve, reject) => {
      const raw = this.socket;
      raw.removeAllListeners('data');
      raw.removeAllListeners('close');
      const s = tls.connect({ socket: raw, servername: this.host, rejectUnauthorized: false });
      this.socket = s;
      s.setTimeout(this.timeoutMs, () => s.destroy(new SMTPError('TLS 握手超时')));
      s.once('error', reject);
      s.once('secureConnect', () => {
        s.removeListener('error', reject);
        this._startReader();
        resolve();
      });
    });
  }

  /* ---------- 高层：会话 ---------- */
  async _auth() {
    if (!this.user) return; // 匿名/本地中继
    const ehlo = this._lastEhlo || [];
    const authLine = ehlo.find((l) => /^AUTH( |$)/i.test(l)) || 'AUTH LOGIN PLAIN';
    if (/\bLOGIN\b/i.test(authLine)) {
      await this._command('AUTH LOGIN', '3', '2');
      await this._command(Buffer.from(this.user).toString('base64'), '3');
      await this._command(Buffer.from(this.pass).toString('base64'), '2');
    } else if (/\bPLAIN\b/i.test(authLine)) {
      const token = Buffer.from('\0' + this.user + '\0' + this.pass).toString('base64');
      await this._command('AUTH PLAIN ' + token, '2');
    } else {
      throw new SMTPError('服务器不支持 AUTH LOGIN/PLAIN，请改用支持认证的端口(465/587)');
    }
  }

  /**
   * 发送一封邮件。
   * @param {object} mail {to: string[], subject, text, html}
   */
  async send(mail) {
    const to = (mail.to || []).map((x) => String(x).trim()).filter(Boolean);
    if (!to.length) throw new SMTPError('收件人为空');
    if (!this.from) throw new SMTPError('发件地址(from)为空，请在设置中配置 SMTP');

    await this._connect();
    const greeting = await this._readResponse();
    if (!greeting.code.startsWith('2')) {
      throw new SMTPError(`服务器问候异常 [${greeting.code}] ${greeting.lines.join(' ')}`);
    }
    const hello = await this._command('EHLO ' + (this.host || 'localhost'), '2');
    this._lastEhlo = hello.lines;

    if (!this.secure) {
      const starttls = hello.lines.some((l) => /^STARTTLS/i.test(l));
      if (starttls && (this.user || this.pass)) {
        await this._command('STARTTLS', '2');
        await this._upgradeToTLS();
        const ehlo2 = await this._command('EHLO ' + (this.host || 'localhost'), '2');
        this._lastEhlo = ehlo2.lines;
      }
    }

    await this._auth();

    await this._command('MAIL FROM:<' + this.from + '>', '2');
    for (const rcpt of to) {
      await this._command('RCPT TO:<' + rcpt + '>', '2');
    }

    const fromLine = this.fromName
      ? `"${this.fromName.replace(/["\r\n]/g, '')}" <${this.from}>`
      : this.from;
    const html = mail.html || escapeHtml(mail.text || '');
    const text = mail.text || stripHtml(html);
    const body =
      'From: ' + fromLine + '\r\n' +
      'To: ' + to.join(', ') + '\r\n' +
      'Subject: =?UTF-8?B?' + Buffer.from(mail.subject || '', 'utf8').toString('base64') + '?=\r\n' +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/html; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Date: ' + new Date().toUTCString() + '\r\n' +
      'X-Mailer: Secretary-Manage\r\n' +
      '\r\n' +
      Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

    await this._write('DATA');
    const dataRes = await this._readResponse();
    if (!dataRes.code.startsWith('3')) {
      throw new SMTPError(`DATA 命令失败 [${dataRes.code}] ${dataRes.lines.join(' ')}`);
    }
    // 发送正文，以 CRLF.CRLF 结束
    await this._write(body.replace(/\r\n\./g, '\r\n..') + '\r\n.');
    await this._command('QUIT', '2');
    this.socket.destroy();
  }

  close() {
    try { this.socket && this.socket.destroy(); } catch { /* noop */ }
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '');
}

/** 便捷函数：直接发送邮件并返回结果描述。 */
async function sendMail(smtpConfig, mail) {
  const client = new SMTPClient(smtpConfig);
  try {
    await client.send(mail);
    return { ok: true, message: '发送成功' };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    client.close();
  }
}

module.exports = { SMTPClient, sendMail };
