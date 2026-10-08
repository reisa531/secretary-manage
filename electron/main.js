'use strict';
/**
 * Electron 主进程：启动内置 HTTP 服务（复用 server.js），并打开应用窗口。
 * - 数据库写入用户数据目录（%APPDATA%\secretary-manage\data），便于后续迁移
 * - 服务仅监听本机回环地址 127.0.0.1，端口随机分配，避免与独立部署冲突
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');

// 固定用户数据目录（ASCII 路径，方便迁移与备份）
app.setPath('userData', path.join(app.getPath('appData'), 'secretary-manage'));

// 必须在 require server 之前设置环境变量
process.env.SECRETARY_DATA_DIR = path.join(app.getPath('userData'), 'data');
process.env.HOST = '127.0.0.1';

let mainWindow = null;

// 单实例锁：重复启动时聚焦已有窗口
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

  app.whenReady().then(() => {
    startServerAndOpen();
  });
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

  // 智慧团建等外链用系统默认浏览器打开，避免在应用内跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
}

function startServerAndOpen() {
  let server;
  try {
    ({ server } = require('../server.js'));
  } catch (e) {
    dialog.showErrorBox('启动失败', '服务初始化出错：' + e.message);
    app.quit();
    return;
  }

  server.on('error', (err) => {
    dialog.showErrorBox('启动失败', '服务启动出错：' + err.message);
    app.quit();
  });

  // 端口传 0，由系统分配一个空闲端口
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    createWindow('http://127.0.0.1:' + port);
  });
}

app.on('window-all-closed', () => {
  app.quit();
});
