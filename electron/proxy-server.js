'use strict';
/**
 * 瘦客户端本地代理服务：
 * - 提供管理界面的静态文件（public/）
 * - 把 /api/* 请求反向代理到云端 API
 * 本地不再持有数据库与业务逻辑。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxyToCloud(req, res, apiBase) {
  const target = String(apiBase).replace(/\/+$/, '') + req.url;
  // 只转发必要请求头：Chromium 的 net.fetch 会拒绝 sec-fetch-* / sec-ch-ua 等浏览器专属头
  const headers = {};
  for (const h of ['cookie', 'content-type', 'authorization', 'accept']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req);

  try {
    const resp = await net.fetch(target, { method: req.method, headers, body, redirect: 'follow' });
    const respHeaders = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    if (typeof resp.headers.getSetCookie === 'function') {
      const cookies = resp.headers.getSetCookie();
      if (cookies.length) respHeaders['set-cookie'] = cookies;
    }
    // net.fetch 已自动解压响应体，需去掉编码/长度头，避免下游再次解压导致失败
    delete respHeaders['content-encoding'];
    delete respHeaders['content-length'];
    delete respHeaders['transfer-encoding'];
    res.writeHead(resp.status, respHeaders);
    res.end(Buffer.from(await resp.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '云端 API 连接失败：' + e.message }));
  }
}

function createProxyServer({ publicDir, apiBase }) {
  return http.createServer(async (req, res) => {
    try {
      const raw = (req.url || '/').split('?')[0];
      const pathname = decodeURIComponent(raw);

      if (pathname.startsWith('/api/')) {
        await proxyToCloud(req, res, apiBase);
        return;
      }

      const rel = pathname === '/' ? '/index.html' : pathname;
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(e.message));
    }
  });
}

module.exports = { createProxyServer };
