'use strict';
/**
 * Electron 主进程（瘦客户端）：
 * - 本地只跑一个轻量代理 + 静态文件服务（electron/proxy-server.js）
 * - /api/* 反向代理到云端 API；管理界面静态文件来自 public/
 * - 不再加载本地数据库与业务逻辑
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createProxyServer } = require('./proxy-server.js');

// 固定用户数据目录（ASCII 路径，便于维护配置）
app.setPath('userData', path.join(app.getPath('appData'), 'secretary-manage'));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

function startAndOpen() {
  // 云端 API 地址：优先环境变量，其次 config.json
  const cfg = loadConfig();
  const apiBase = process.env.SECRETARY_API_BASE || cfg.apiBase || '';
  if (!apiBase) {
    dialog.showErrorBox('未配置云端 API 地址',
      '请在配置文件 %APPDATA%\\secretary-manage\\config.json 中填写 "apiBase"，例如：\n\n{"apiBase": "https://your-api.vercel.app"}');
    app.quit();
    return;
  }
  if (!cfg.apiBase || cfg.apiBase !== apiBase) {
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
