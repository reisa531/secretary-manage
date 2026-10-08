'use strict';
// 数据库迁移：独立部署 data/secretary.db → 桌面版用户数据目录 %APPDATA%\secretary-manage\data\
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SRC_DIR = path.join(__dirname, '..', 'data');
const DST_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'secretary-manage', 'data');
const srcDb = path.join(SRC_DIR, 'secretary.db');
const dstDb = path.join(DST_DIR, 'secretary.db');

if (!fs.existsSync(srcDb)) {
  console.error('源数据库不存在：' + srcDb);
  process.exit(1);
}

// 1) 读取源库信息并 checkpoint（把 WAL 合并进主库文件）
const src = new DatabaseSync(srcDb);
const sMember = src.prepare('SELECT COUNT(*) c FROM members').get().c;
const sSetting = src.prepare('SELECT COUNT(*) c FROM settings').get().c;
src.exec('PRAGMA wal_checkpoint(TRUNCATE);');
src.close();
console.log(`源库: members=${sMember} settings=${sSetting}（已 checkpoint）`);

// 2) 复制主库到目标，清理目标残留 wal/shm
if (!fs.existsSync(DST_DIR)) fs.mkdirSync(DST_DIR, { recursive: true });
fs.copyFileSync(srcDb, dstDb);
for (const f of ['secretary.db-wal', 'secretary.db-shm']) {
  const d = path.join(DST_DIR, f);
  if (fs.existsSync(d)) fs.rmSync(d);
}
console.log('已复制到：' + dstDb);

// 3) 校验目标库
const dst = new DatabaseSync(dstDb);
const dMember = dst.prepare('SELECT COUNT(*) c FROM members').get().c;
const dSetting = dst.prepare('SELECT COUNT(*) c FROM settings').get().c;
const smtpHost = dst.prepare("SELECT value FROM settings WHERE key='smtp_host'").get()?.value || '';
const aiModel = dst.prepare("SELECT value FROM settings WHERE key='ai_model'").get()?.value || '';
const aiKeySet = !!dst.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get()?.value;
const smtpPassSet = !!dst.prepare("SELECT value FROM settings WHERE key='smtp_pass'").get()?.value;
dst.close();

console.log(`目标库: members=${dMember} settings=${dSetting}`);
console.log(`目标库 smtp_host=${smtpHost} ai_model=${aiModel} ai_key已配置=${aiKeySet} smtp授权码已配置=${smtpPassSet}`);
const ok = dMember === sMember && dSetting === sSetting;
console.log(ok ? '数据库迁移成功 ✓' : '迁移结果不一致，请检查 ✗');
process.exit(ok ? 0 : 1);
