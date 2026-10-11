# 团支部管理平台

面向团支部书记的管理平台：团员管理、团费收缴、团员画像、团支部数字画像、活动通知、信息发布与投票。

架构为 **云端服务 + 本地瘦客户端**：

- **云端**（`cloud/`）：Next.js（App Router）应用，同时承载 REST API（`/api/*`）与公开站点（信息发布、投票），数据库为 Neon PostgreSQL，部署在 Vercel。
- **管理端**（`electron/` + `public/`）：Electron 瘦客户端，只渲染管理界面，通过本地代理把 `/api/*` 转发到云端 API，本地不持有数据库。

## 目录结构

```
secretary-manage/
├── cloud/                 # 云端应用（API + 公开站点）
│   ├── app/               #   Next.js 路由（api/ 与公开页面）
│   ├── lib/               #   业务逻辑（db/auth/api/smtp/ai/analysis/schema/ready/settings）
│   ├── db/                #   schema 与迁移脚本
│   ├── scripts/           #   本地冒烟测试
│   ├── package.json
│   ├── next.config.mjs
│   ├── vercel.json
│   └── .env.example       #   环境变量示例
├── electron/              # Electron 瘦客户端
│   ├── main.js            #   主进程：本地代理 + 静态文件
│   └── proxy-server.js    #   /api/* 反代到云端
├── public/                # 管理端 SPA（打包进 Electron）
├── package.json           # Electron 打包配置
└── README.md
```

## 一、云端部署（Vercel + Neon）

1. 在 Vercel 创建项目并关联本仓库的 `cloud/` 目录（框架自动识别为 Next.js，`cloud/vercel.json` 已配置）。
2. 在项目中配置环境变量（生产环境用 Secret 类型）：
   - `DATABASE_URL`：Neon PostgreSQL 连接串（可用 Vercel 的 Neon 集成自动注入）。
   - `SESSION_SECRET`：会话签名密钥（随机强密钥）。
   - `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`（可选）：首次启动无管理员时自动创建初始管理员。
3. 部署。应用首次收到请求时会**自动建表**（幂等 schema 内置于 `cloud/lib/schema.js`）并写入默认设置，无需手工跑迁移。

## 二、Electron 瘦客户端

管理端桌面程序只做「界面 + 反代」，云端 API 地址由用户数据目录下的 `config.json` 指定。

```json
{ "apiBase": "https://your-api.vercel.app" }
```

- 首次运行若未配置，会提示填写该文件（`%APPDATA%\secretary-manage\config.json`）。
- 打包安装程序：

```bash
npm install
npm run dist        # 生成 dist/团支部管理平台 Setup x.x.x.exe
```

## 三、本地开发

```bash
cd cloud
npm install
cp .env.example .env.local   # 填入本地 PostgreSQL 连接串
npm run dev                  # http://localhost:3000
```

本地测试：

```bash
cd cloud
node scripts/smoke.mjs          # 核心 API 冒烟
node scripts/test-content.mjs   # 信息发布 + 投票
node scripts/test-poll-extra.mjs
```

## 四、功能

- **团员管理**：增删改查、搜索、CSV 导入导出、团员画像（AI 总结）、团支部数字画像。
- **团费收缴**：发起收缴（期数+金额）、邮件通知、逐人登记缴纳状态与订单号、自动判定完成。
- **活动管理**：创建活动、一键邮件通知。
- **邮件通知**：SMTP 适配、自定义发送、发送记录。
- **智慧团建**：无官方 API，以超链接形式对接「三会两制一课」等入口。
- **信息发布**：标题/正文/分类/置顶/发布时间，草稿与发布状态，发布后公开可见。
- **投票**：单选/多选、匿名/实名、结果可见性、时间窗口、改票、一人一票、实时计票、参与率、CSV 导出。
- **用户系统**：管理员邮箱+密码登录；团员（投票人）以「姓名 + 学号」认证登录投票。

## 五、数据迁移（从旧独立版 SQLite 迁移）

旧版独立部署（`node:sqlite`）的数据可迁移到云端 Postgres：

```bash
cd cloud
node db/migrate.mjs         # 建表（幂等）
SQLITE_DB=../data/secretary.db DATABASE_URL=postgresql://... node db/migrate-sqlite.mjs  # 迁移数据
```

迁移会：复制 settings/members/activities/email_log/fee 等，并由 `settings.admin_password` + SMTP 邮箱生成管理员账号。
