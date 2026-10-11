import crypto from 'node:crypto';

/**
 * 认证工具：密码哈希（scrypt，零依赖）、HMAC 签名会话 token、Cookie 辅助。
 * 会话采用无状态 HMAC 签名 token（存 httpOnly cookie），适配 Vercel serverless。
 */

const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 天

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

export function verifyPassword(input, stored) {
  if (!stored) return false;
  if (String(stored).startsWith('scrypt$')) {
    const [, salt, hash] = String(stored).split('$');
    const calc = crypto.scryptSync(String(input), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
  }
  return String(input) === String(stored); // 兼容旧明文/旧格式
}

function secret() {
  return process.env.SESSION_SECRET || 'dev-secret-change-me';
}

function sign(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + SESSION_TTL_SECONDS * 1000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  res.headers.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);
}

export function clearSessionCookie(res) {
  res.headers.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

export function getSessionToken(req) {
  const cookie = req.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'sid') return rest.join('=');
  }
  return null;
}
