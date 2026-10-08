# 团支部管理平台

一个**零外部依赖、本地化部署**的团支部管理 Web 应用。面向团支部书记，用于管理团员信息、对接智慧团建、生成团员画像与团支部数字画像、一键邮件发布活动通知。

> 技术栈：Node.js ≥ 22.5（内置 `http` + `node:sqlite` + `fetch` + `crypto`），**无需 npm install，无需联网即可运行**。数据保存在本机 SQLite 文件 `data/secretary.db`。

## 一、功能总览

| 模块 | 说明 |
| --- | --- |
| 🏠 仪表盘 | 团员总数、画像/团费/活动/邮件统计，性别与志愿分布图，最近添加团员，快捷入口 |
| 👥 团员管理 | 团员增删改查、多维度字段、搜索/筛选、CSV 导入/导出、个人详情页 |
| 🧩 团员画像 | 基于「自我介绍 + 管理员补充」调用 AI 总结性格/兴趣/特长/志愿倾向/角色建议，支持单个或批量生成 |
| 📈 数字画像 | 性别/年龄/政治面貌/爱好 TOP/特长 TOP/志愿意愿/团内职务/活动类型等多维度可视化，一键 AI 生成团支书工作建议 |
| 💰 团费收缴 | 发起收缴（期数+金额）、通知生成邮件可编辑后发送、逐人登记缴纳状态与订单号、自动判定收缴完成 |
| 📅 活动管理 | 创建活动、勾选参与人员、一键邮件通知 |
| ✉️ 邮件通知 | SMTP 适配（QQ/163/Gmail/企业邮箱等），自定义发送、发送记录 |
| 🔗 智慧团建 | 无官方 API，以**超链接**形式跳转各功能入口，路由表可在设置中维护 |
| ⚙️ 系统设置 | 站点信息、SMTP、AI 接口、智慧团建路由表、管理员密码 |

## 二、快速开始

### 环境要求
- [Node.js](https://nodejs.org) **22.5 及以上**（内置 SQLite 支持）

### 启动（Windows）
双击 `start.bat`，或在项目目录执行：
```bat
node server.js
```
浏览器打开 <http://localhost:8081>，默认管理员密码 `admin123`（登录后请在「系统设置」中修改）。

### 开始菜单快捷方式（Windows）
双击开始菜单中的「团支部管理平台」快捷方式即可一键启动：脚本会先探测服务器健康状态（`/api/health`），若未运行则自动以最小化窗口启动服务器，待就绪后自动打开浏览器。快捷方式指向 `启动平台.bat`（其调用 `start-platform.ps1` 完成全部逻辑）。

如需手动创建/重建该快捷方式，运行：
```powershell
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\团支部管理平台.lnk")
$lnk.TargetPath = "E:\Projects\secretary-manage\启动平台.bat"
$lnk.WorkingDirectory = "E:\Projects\secretary-manage"
$lnk.Save()
```


### 启动（Linux / macOS）
```bash
./start.sh
# 或
node server.js
```

### 自定义端口
```bash
# Windows
set PORT=8080 && node server.js
# Linux/macOS
PORT=8080 node server.js
```

## 三、配置说明

登录后进入「系统设置」完成以下配置：

### 1. SMTP 邮件（必配，用于活动通知）
| 邮箱 | SMTP 服务器 | 端口 | 加密 |
| --- | --- | --- | --- |
| QQ 邮箱 | smtp.qq.com | 465 | SSL/TLS |
| 163 邮箱 | smtp.163.com | 465 | SSL/TLS |
| Gmail | smtp.gmail.com | 465 | SSL/TLS |

> 需在邮箱设置中开启 SMTP 服务并获取**授权码**，将授权码填入「授权码/密码」。

### 2. AI 接口（用于画像与建议）
支持 **OpenAI 兼容** 接口（DeepSeek / OpenAI / 通义 / 智谱 / Kimi / SiliconFlow 等）与 **Ollama 原生** 接口。

- 示例（DeepSeek）：接口地址 `https://api.deepseek.com/v1`，模型 `deepseek-chat`
- 本地离线方案：安装 [Ollama](https://ollama.com) 后，接口类型选「Ollama 原生」，地址填 `http://localhost:11434`，模型填如 `qwen2.5:7b`

> 未配置 AI 时，画像生成会自动降级为**规则画像**（依据爱好/特长/志愿字段），不影响其余功能。

### 3. 智慧团建路由表
智慧团建系统网址为 <https://zhtj.youth.cn/zhtj/>（网上共青团·智慧团建）。官方无公开 API，本平台以超链接形式对接，已内置「三会两制一课」等精确入口：

- 系统登录、支部团员大会、支部委员会、团小组会、团课、两制（团员教育评议与团籍注册）、团日活动、“两红两优”评选、团课资源、团务百科

如需增删或调整，请在「系统设置 → 智慧团建路由表」中维护（每条含名称、URL、说明），修改即时生效。

## 四、团员数据字段

- **基本信息**：姓名、性别、出生日期、民族、籍贯、政治面貌、学号、专业、所属导师组、手机、邮箱
- **团务信息**（政治面貌为「群众」时自动隐藏）：入团时间、团员编号、团内职务、智慧团建个人链接
- **画像与志愿**：兴趣爱好、特长、技能、志愿服务意愿、可参与志愿类型、画像标签
- **介绍与补充**：自我介绍、管理员补充观察（两者共同作为 AI 画像输入）

> 团费不再作为团员字段，改为独立的「团费收缴」模块：发起收缴（期数+金额）→ 通知（生成邮件、可编辑后发送）→ 逐人登记缴纳状态与订单号 → 全部缴/免缴后自动完成。

### CSV 导入
列名示例（首行为表头，需包含 `name`）：
```csv
name,gender,student_no,email,hobbies,specialties,volunteer_willing,self_intro
张三,男,2023001,zhang@example.com,"篮球,读书","摄影,写作",1,性格开朗乐于助人
```
可用列：`name, gender, birth_date, nation, native_place, political_status, join_league_date, org_name, phone, email, student_no, major, league_no, league_role, hobbies, specialties, skills, volunteer_willing, volunteer_types, self_intro, admin_notes, tags`（其中 `org_name` 即「所属导师组」）

其中 `volunteer_willing`：0=未标注，1=愿意参与，2=视情况参与，3=暂不参与。

## 五、数据与备份

- 所有数据保存在 `data/secretary.db`（SQLite），**备份即复制 `data/` 目录**。
- 导出 CSV：团员管理页右上角「导出 CSV」。
- 恢复：备份 `data/` 目录，重新启动即可。

## 六、安全说明

- 管理员密码使用 scrypt 加盐哈希存储（首次登录会自动将默认明文密码升级为哈希）。
- 默认监听 `0.0.0.0`，如仅本机使用，可设环境变量 `HOST=127.0.0.1` 启动。
- SMTP 授权码、AI API Key 均仅保存在本机数据库，不对外传输。

## 七、目录结构

```
secretary-manage/
├── server.js          # 后端入口（HTTP 服务 + API 路由）
├── lib/
│   ├── db.js          # SQLite 建表、默认设置、种子数据
│   ├── smtp.js        # 零依赖 SMTP 客户端（25/465/587 + STARTTLS + AUTH）
│   ├── ai.js          # AI 客户端（OpenAI 兼容 / Ollama）
│   └── analysis.js    # 团支部数字画像规则分析引擎
├── public/
│   ├── index.html     # 前端壳
│   ├── app.js         # 前端 SPA 逻辑
│   ├── styles.css     # 样式
│   └── charts.js      # 纯 SVG 图表
├── electron/main.js   # Electron 主进程（内置服务 + 应用窗口）
├── scripts/           # 冒烟测试脚本
├── start.bat / start.sh / 启动平台.bat / start-platform.ps1   # 一键启动脚本
├── dist/              # electron-builder 输出（安装程序）
└── data/secretary.db  # 运行时生成的数据库（已 gitignore）
```

## 八、Electron 桌面版（Windows 安装程序）

```bash
npm install          # 需 Node ≥ 22.5
npm run dist         # 生成 dist\团支部管理平台 Setup 1.0.0.exe
```

- 安装程序为 NSIS 安装包，可自定义安装目录；安装后自动创建桌面与开始菜单快捷方式。
- 桌面版内置 HTTP 服务，仅监听 `127.0.0.1` 随机端口，应用窗口直接加载，无需浏览器。
- **数据目录**：桌面版数据保存在 `%APPDATA%\secretary-manage\data\secretary.db`（非安装目录），卸载不会丢数据。
- **数据迁移**：将独立部署的 `data\secretary.db`（含 `.db-wal`/`.db-shm`）复制到上述目录即可。
- 提示：若构建时无法访问 GitHub，Electron 二进制与打包工具已通过 `.npmrc` 配置了 npmmirror 镜像。

## 九、从互联网调研补充的功能

基于智慧团建官方操作指南与团组织数字化建设实践，额外纳入：
- 「三会两制一课」核心入口（支部团员大会、支部委员会、团小组会、团课、两制）直达超链接
- 团日活动、“两红两优”评选、团课资源、团务百科等智慧团建功能入口
- 志愿服务意愿标签化 + 志愿类型统计，便于快速识别积极分子
- 团员画像标签体系，支撑团支书精准分工（如谁擅长组织、谁擅长宣传）
