'use strict';
/**
 * Electron 主进程（瘦客户端）：
 * - 启动时校验云端 API 地址（apiBase）；未配置或不可用时弹出窗口要求输入
 * - 本地只跑一个轻量代理 + 静态文件服务（electron/proxy-server.js）
 * - /api/* 反向代理到云端 API；管理界面静态文件来自 public/
 */
const { app, BrowserWindow, shell, dialog, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createProxyServer } = require('./proxy-server.js');

app.setPath('userData', path.join(app.getPath('appData'), 'secretary-manage'));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DIALOG_PRELOAD = path.join(__dirname, 'dialog-preload.js');

function loadConfig() {
  const file = path.join(app.getPath('userData'), 'config.json');
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* 配置损坏则回退默认 */ }
  return {};
}

function saveConfig(cfg) {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 校验云端 API 地址是否可用（访问 /api/ready 并核对服务标识） */
async function checkApiBase(apiBase) {
  const url = String(apiBase).replace(/\/+$/, '') + '/api/ready';
  try {
    const resp = await net.fetch(url, { method: 'GET', redirect: 'follow' });
    if (!resp.ok) return { ok: false, reason: '返回状态 HTTP ' + resp.status };
    const data = await resp.json().catch(() => ({}));
    if (data && data.ok === true && data.service === 'secretary-manage-cloud') return { ok: true };
    return { ok: false, reason: '该地址不是本平台的 API 服务' };
  } catch (e) {
    return { ok: false, reason: e.message || '无法连接' };
  }
}

/* 弹出窗口要求输入云端 API 地址；返回输入值，取消则返回 null */
function askApiBase(defaultValue, errorMsg) {
  return new Promise((resolve) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; padding: 26px; color: #1f2733; }
      h2 { margin: 0 0 8px; font-size: 18px; color: #c8102e; }
      p { margin: 0 0 12px; font-size: 13px; color: #6b7280; }
      .err { color: #e03131; min-height: 18px; }
      input { width: 100%; padding: 9px 11px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
      .btns { margin-top: 16px; text-align: right; }
      button { padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; font-size: 14px; }
      #ok { background: #c8102e; color: #fff; margin-left: 8px; }
      #cancel { background: #fff; color: #1f2733; border-color: #d0d5dd; }
      </style></head><body>
      <h2>配置云端 API 地址</h2>
      <p>请输入团支部管理平台云端服务的地址（用于管理端接入云端数据）。</p>
      <div class="err">${escapeHtml(errorMsg || '')}</div>
      <input id="api" type="text" value="${escapeHtml(defaultValue || '')}" placeholder="https://your-api.vercel.app">
      <div class="btns"><button id="cancel">取消</button><button id="ok">确定</button></div>
      <script>
        const input = document.getElementById('api');
        document.getElementById('ok').addEventListener('click', () => window.apiBaseDialog.submit(input.value.trim()));
        document.getElementById('cancel').addEventListener('click', () => window.apiBaseDialog.cancel());
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.apiBaseDialog.submit(input.value.trim()); });
        input.focus();
      </script></body></html>`;

    const win = new BrowserWindow({
      width: 560,
      height: 320,
      resizable: false,
      modal: true,
      title: '配置云端 API 地址',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: DIALOG_PRELOAD,
      },
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('api-base-dialog', onMsg);
      resolve(value);
      if (!win.isDestroyed()) win.close();
    };
    const onMsg = (event, payload) => {
      if (event.sender !== win.webContents) return;
      if (payload && payload.action === 'submit') finish(String(payload.value || '').trim() || null);
      else finish(null);
    };
    ipcMain.on('api-base-dialog', onMsg);
    win.on('closed', () => finish(null));
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.once('ready-to-show', () => win.show());
  });
}

let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => startAndOpen());
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: '团支部管理平台',
    autoHideMenuBar: true,
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(url);
}

async function startAndOpen() {
  const cfg = loadConfig();
  let apiBase = process.env.SECRETARY_API_BASE || cfg.apiBase || '';

  // 校验：未配置或不可用时循环弹窗要求输入
  let check = apiBase ? await checkApiBase(apiBase) : { ok: false, reason: '尚未配置云端 API 地址' };
  while (!check.ok) {
    apiBase = await askApiBase(apiBase, check.reason);
    if (!apiBase) { app.quit(); return; } // 用户取消
    cfg.apiBase = apiBase;
    saveConfig(cfg);
    check = await checkApiBase(apiBase);
  }
  if (cfg.apiBase !== apiBase) {
    cfg.apiBase = apiBase;
    saveConfig(cfg);
  }

  const server = createProxyServer({ publicDir: PUBLIC_DIR, apiBase });
  server.on('error', (err) => {
    dialog.showErrorBox('启动失败', '本地代理服务启动出错：' + err.message);
    app.quit();
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    createWindow('http://127.0.0.1:' + port);
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
