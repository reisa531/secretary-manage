'use strict';
/* 团支部管理平台 —— 前端 SPA（零外部依赖，hash 路由 + fetch 调用） */

/* ============================ 基础工具 ============================ */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// 转义用于内联 onclick 中单引号字符串参数
function jsq(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch('/api/' + path, opts);
  let data;
  try { data = await resp.json(); } catch { data = {}; }
  if (!resp.ok) throw new Error(data.error || ('请求失败 HTTP ' + resp.status));
  return data;
}

function toast(msg, type = 'ok') {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : 'info');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function openModal(html, narrow = false) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-mask"><div class="modal ${narrow ? 'narrow' : ''}">${html}</div></div>`;
  const mask = root.querySelector('.modal-mask');
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
function modalHtml(title, body, foot) {
  return `<div class="modal-head"><h3>${esc(title)}</h3><button class="close" onclick="closeModal()">×</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
}

function fmtDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 10);
}
function displayTags(text) {
  const arr = String(text || '').split(/[,，、;；/\s]+/).filter(Boolean);
  return arr.map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '<span class="muted">—</span>';
}

const VOLUNTEER_LABELS = ['未标注', '愿意参与', '视情况参与', '暂不参与'];
function volLabel(v) { return VOLUNTEER_LABELS[Number(v) || 0]; }
function volTag(v) {
  const m = { 0: 'gray', 1: 'green', 2: 'orange', 3: 'gray' }[Number(v) || 0];
  return `<span class="tag ${m}">${volLabel(v)}</span>`;
}

/* ============================ 字段定义 ============================ */
const MEMBER_SECTIONS = [
  {
    title: '基本信息',
    fields: [
      { key: 'name', label: '姓名', type: 'text', required: true },
      { key: 'gender', label: '性别', type: 'select', options: ['', '男', '女'] },
      { key: 'birth_date', label: '出生日期', type: 'date' },
      { key: 'nation', label: '民族', type: 'text' },
      { key: 'native_place', label: '籍贯', type: 'text' },
      { key: 'political_status', label: '政治面貌', type: 'select', options: ['', '中共党员', '中共预备党员', '共青团员', '群众', '其他'] },
      { key: 'student_no', label: '学号', type: 'text' },
      { key: 'major', label: '专业', type: 'text' },
      { key: 'org_name', label: '所属导师组', type: 'text' },
      { key: 'phone', label: '手机', type: 'text' },
      { key: 'email', label: '邮箱', type: 'email' },
    ],
  },
  {
    title: '团务信息',
    leagueOnly: true,
    fields: [
      { key: 'join_league_date', label: '入团时间', type: 'date' },
      { key: 'league_no', label: '团员编号', type: 'text' },
      { key: 'league_role', label: '团内职务', type: 'select', options: ['', '团支部书记', '团支部副书记', '组织委员', '宣传委员', '普通团员'] },
      { key: 'zhtj_url', label: '智慧团建个人链接', type: 'text' },
    ],
  },
  {
    title: '画像与志愿',
    fields: [
      { key: 'hobbies', label: '兴趣爱好（逗号分隔）', type: 'text' },
      { key: 'specialties', label: '特长（逗号分隔）', type: 'text' },
      { key: 'skills', label: '技能（逗号分隔）', type: 'text' },
      { key: 'volunteer_willing', label: '志愿服务意愿', type: 'select', options: ['0:未标注', '1:愿意参与', '2:视情况参与', '3:暂不参与'] },
      { key: 'volunteer_types', label: '可参与志愿类型', type: 'text' },
      { key: 'tags', label: '画像标签', type: 'text' },
    ],
  },
  {
    title: '介绍与补充',
    fields: [
      { key: 'self_intro', label: '自我介绍', type: 'textarea', full: true },
      { key: 'admin_notes', label: '管理员补充观察', type: 'textarea', full: true },
    ],
  },
];

function memberFormHtml(member) {
  let html = '';
  for (const sec of MEMBER_SECTIONS) {
    html += `<div class="member-sec" data-sec="${esc(sec.title)}" style="display:contents">
      <div class="form-section">${esc(sec.title)}</div>`;
    for (const f of sec.fields) {
      const val = member ? (member[f.key] ?? '') : '';
      const id = 'fld_' + f.key;
      const full = f.full ? ' full' : '';
      let input;
      if (f.type === 'select') {
        let opts = '';
        for (const o of f.options) {
          const [ov, ol] = o.split(':');
          const v = ov || '';
          opts += `<option value="${esc(v)}" ${String(val) === v ? 'selected' : ''}>${esc(ol || ov || '请选择')}</option>`;
        }
        input = `<select id="${id}">${opts}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}">${esc(val)}</textarea>`;
      } else {
        input = `<input type="${f.type}" id="${id}" value="${esc(val)}" ${f.required ? 'required' : ''}>`;
      }
      html += `<div class="form-item${full}"><label>${esc(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>${input}</div>`;
    }
    html += `</div>`;
  }
  return `<form id="memberForm" class="form-grid">${html}</form>`;
}

function collectMemberForm() {
  const out = {};
  for (const sec of MEMBER_SECTIONS) for (const f of sec.fields) {
    const el = document.getElementById('fld_' + f.key);
    if (!el) continue;
    out[f.key] = el.value;
  }
  return out;
}

// 政治面貌为"群众"时隐藏团务信息区块
function syncLeagueSection() {
  const statusEl = document.getElementById('fld_political_status');
  const secEl = document.querySelector('.member-sec[data-sec="团务信息"]');
  if (!secEl) return;
  const isMass = statusEl && statusEl.value === '群众';
  secEl.style.display = isMass ? 'none' : 'contents';
}

/* ============================ 登录 ============================ */
async function tryLogin() {
  const email = ($('#loginEmail').value || '').trim();
  const pwd = $('#loginPwd').value;
  $('#loginErr').textContent = '';
  if (!email || !pwd) { $('#loginErr').textContent = '请输入邮箱和密码'; return; }
  try {
    await api('POST', 'auth/login', { email, password: pwd });
    showApp();
    location.hash = '#/dashboard';
  } catch (e) {
    $('#loginErr').textContent = e.message;
  }
}

async function checkLogin() {
  try {
    await api('GET', 'auth/me');
    return true;
  } catch { return false; }
}

function showApp() { $('#loginView').style.display = 'none'; $('#appView').style.display = 'flex'; }
function showLogin() { $('#appView').style.display = 'none'; $('#loginView').style.display = 'flex'; }

/* ============================ 路由 ============================ */
const NAV = [
  { path: 'dashboard', label: '仪表盘', icon: '📊' },
  { path: 'members', label: '团员管理', icon: '👥' },
  { path: 'portraits', label: '团员画像', icon: '🧩' },
  { path: 'branch', label: '数字画像', icon: '📈' },
  { path: 'fees', label: '团费收缴', icon: '💰' },
  { path: 'activities', label: '活动管理', icon: '📅' },
  { path: 'posts', label: '信息发布', icon: '📢' },
  { path: 'polls', label: '投票管理', icon: '🗳️' },
  { path: 'email', label: '邮件通知', icon: '✉️' },
  { path: 'zhtj', label: '智慧团建', icon: '🔗' },
  { path: 'settings', label: '系统设置', icon: '⚙️' },
];

function renderNav(active) {
  $('#nav').innerHTML = NAV.map((n) =>
    `<div class="nav-item ${active === n.path ? 'active' : ''}" data-path="${n.path}"><span class="ico">${n.icon}</span>${esc(n.label)}</div>`
  ).join('');
  $$('#nav .nav-item').forEach((el) => el.addEventListener('click', () => { location.hash = '#/' + el.dataset.path; }));
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, param] = hash.split('/');
  const page = path || 'dashboard';
  renderNav(page);
  const titles = { dashboard: '仪表盘', members: '团员管理', portraits: '团员画像', branch: '团支部数字画像', fees: '团费收缴', activities: '活动管理', posts: '信息发布', polls: '投票管理', email: '邮件通知', zhtj: '智慧团建', settings: '系统设置' };
  $('#pageTitle').textContent = titles[page] || '';
  const content = $('#content');
  content.innerHTML = '<div class="loading">加载中…</div>';
  try {
    if (page === 'dashboard') await renderDashboard(content);
    else if (page === 'members') await renderMembers(content, param);
    else if (page === 'portraits') await renderPortraits(content);
    else if (page === 'branch') await renderBranch(content);
    else if (page === 'fees') await renderFees(content, param);
    else if (page === 'activities') await renderActivities(content);
    else if (page === 'posts') await renderPosts(content);
    else if (page === 'polls') await renderPolls(content);
    else if (page === 'email') await renderEmail(content);
    else if (page === 'zhtj') await renderZhtj(content);
    else if (page === 'settings') await renderSettings(content);
    else content.innerHTML = '<div class="empty">页面不存在</div>';
  } catch (e) {
    content.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

/* ============================ 仪表盘 ============================ */
async function renderDashboard(c) {
  const d = await api('GET', 'dashboard');
  c.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">团员总数</div><div class="value red">${d.total}</div></div>
      <div class="stat-card"><div class="label">已生成画像</div><div class="value">${d.portraitCount}</div></div>
      <div class="stat-card"><div class="label">团费收缴中</div><div class="value">${d.feeActiveCount || 0}</div></div>
      <div class="stat-card"><div class="label">活动数</div><div class="value">${d.activityCount}</div></div>
      <div class="stat-card"><div class="label">邮件发送</div><div class="value">${d.emailCount}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>快捷操作</h3></div>
      <div class="rows">
        <button class="btn btn-primary" onclick="openMemberModal()">＋ 添加团员</button>
        <button class="btn btn-outline" onclick="location.hash='#/fees'">💰 发起团费收缴</button>
        <button class="btn btn-outline" onclick="location.hash='#/activities'">📅 新建活动</button>
        <button class="btn btn-outline" onclick="location.hash='#/email'">✉️ 发送通知</button>
        <button class="btn btn-outline" onclick="location.hash='#/branch'">📈 查看数字画像</button>
        <button class="btn btn-outline" onclick="location.hash='#/zhtj'">🔗 智慧团建</button>
      </div>
    </div>
    <div class="grid-2">
      <div class="chart-box">
        <h4>性别分布</h4>
        <div id="cGender"></div>
      </div>
      <div class="chart-box">
        <h4>志愿服务意愿</h4>
        <div id="cVol"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>最近添加的团员</h3><a href="#/members">查看全部 →</a></div>
      ${d.recent.length ? `<table class="tbl"><thead><tr><th>姓名</th><th>性别</th><th>团内职务</th><th>邮箱</th><th>画像</th></tr></thead>
      <tbody>${d.recent.map((m) => `<tr>
        <td><a href="#/members/${m.id}">${esc(m.name)}</a></td>
        <td>${esc(m.gender) || '—'}</td>
        <td>${esc(m.league_role) || '—'}</td>
        <td>${esc(m.email) || '—'}</td>
        <td>${m.portrait ? '<span class="badge ok">已生成</span>' : '<span class="badge no">未生成</span>'}</td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无团员，点击「添加团员」开始</div>'}
    </div>`;
  ChartX.renderPie($('#cGender'), d.stats.gender, { donut: true, centerText: d.total });
  ChartX.renderBars($('#cVol'), d.stats.volunteer_willing, { height: 200 });
}

/* ============================ 团员管理 ============================ */
async function renderMembers(c, param) {
  if (param && /^\d+$/.test(param)) { return renderMemberDetail(c, Number(param)); }
  const data = await api('GET', 'members');
  const members = data.members;
  c.innerHTML = `
    <div class="toolbar">
      <input type="text" id="mSearch" placeholder="搜索姓名/学号/编号/手机/专业…">
      <select id="mVol"><option value="">志愿意愿</option><option value="1">愿意参与</option><option value="2">视情况参与</option><option value="3">暂不参与</option></select>
      <div class="spacer"></div>
      <button class="btn btn-ghost" id="mImport">导入 CSV</button>
      <a class="btn btn-ghost" href="/api/members/export" download>导出 CSV</a>
      <button class="btn btn-primary" onclick="openMemberModal()">＋ 添加团员</button>
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>姓名</th><th>性别</th><th>学号</th><th>团内职务</th><th>导师组</th><th>兴趣爱好</th><th>志愿</th><th>画像</th><th>操作</th></tr></thead>
      <tbody id="mTbody"></tbody>
    </table></div>
    <div class="muted mt" id="mCount"></div>`;

  function renderList() {
    const q = $('#mSearch').value.trim();
    const vol = $('#mVol').value;
    const list = members.filter((m) => {
      if (vol && Number(m.volunteer_willing) !== Number(vol)) return false;
      if (q) {
        const hay = [m.name, m.student_no, m.league_no, m.phone, m.email, m.major, m.org_name, m.tags].join(' ');
        if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
      }
      return true;
    });
    $('#mTbody').innerHTML = list.map((m) => `<tr>
      <td><a href="#/members/${m.id}">${esc(m.name)}</a></td>
      <td>${esc(m.gender) || '—'}</td>
      <td>${esc(m.student_no) || '—'}</td>
      <td>${esc(m.league_role) || '—'}</td>
      <td>${esc(m.org_name) || '—'}</td>
      <td>${displayTags(m.hobbies)}</td>
      <td>${volTag(m.volunteer_willing)}</td>
      <td>${m.portrait ? '<span class="badge ok">已生成</span>' : '<span class="badge no">未生成</span>'}</td>
      <td><div class="ops">
        <button class="btn btn-ghost btn-sm" onclick="openMemberModal(${m.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="delMember(${m.id}, '${jsq(m.name)}')">删除</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty">暂无匹配的团员</td></tr>';
    $('#mCount').textContent = `共 ${list.length} / ${members.length} 名团员`;
  }
  ['input', 'change'].forEach((ev) => { $('#mSearch').addEventListener(ev, renderList); $('#mVol').addEventListener(ev, renderList); });
  $('#mImport').addEventListener('click', openImportModal);
  renderList();
}

async function renderMemberDetail(c, id) {
  const { member } = await api('GET', 'members/' + id);
  const p = member.portrait_obj;
  c.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${esc(member.name)} <span class="muted" style="font-weight:400;font-size:13px">${esc(member.student_no || '')} ${esc(member.league_role || '')}</span></h3>
        <div class="rows">
          <button class="btn btn-primary" onclick="openMemberModal(${member.id})">编辑资料</button>
          <button class="btn btn-outline" onclick="genOnePortrait(${member.id}, this)">✨ 生成画像</button>
          <button class="btn btn-ghost" onclick="location.hash='#/members'">← 返回列表</button>
        </div>
      </div>
      <div class="kv">
        <div class="k">性别</div><div>${esc(member.gender) || '—'}</div>
        <div class="k">出生日期</div><div>${fmtDate(member.birth_date)}</div>
        <div class="k">民族 / 籍贯</div><div>${esc(member.nation) || '—'} / ${esc(member.native_place) || '—'}</div>
        <div class="k">政治面貌</div><div>${esc(member.political_status) || '—'}</div>
        <div class="k">专业</div><div>${esc(member.major) || '—'}</div>
        <div class="k">手机 / 邮箱</div><div>${esc(member.phone) || '—'} / ${esc(member.email) || '—'}</div>
        <div class="k">入团时间</div><div>${fmtDate(member.join_league_date)}</div>
        <div class="k">团员编号</div><div>${esc(member.league_no) || '—'}</div>
        <div class="k">所属导师组</div><div>${esc(member.org_name) || '—'}</div>
        <div class="k">志愿服务意愿</div><div>${volTag(member.volunteer_willing)}</div>
        <div class="k">智慧团建</div><div>${member.zhtj_url ? `<a href="${esc(member.zhtj_url)}" target="_blank" rel="noopener">打开个人页面 →</a>` : '—'}</div>
      </div>
      <div class="mt"><strong>兴趣爱好：</strong>${displayTags(member.hobbies)}</div>
      <div class="mt"><strong>特长：</strong>${displayTags(member.specialties)}</div>
      <div class="mt"><strong>技能：</strong>${displayTags(member.skills)}</div>
      ${member.volunteer_types ? `<div class="mt"><strong>可参与志愿类型：</strong>${displayTags(member.volunteer_types)}</div>` : ''}
      ${member.self_intro ? `<div class="mt"><strong>自我介绍：</strong><p>${esc(member.self_intro).replace(/\n/g, '<br>')}</p></div>` : ''}
      ${member.admin_notes ? `<div class="mt"><strong>管理员补充：</strong><p>${esc(member.admin_notes).replace(/\n/g, '<br>')}</p></div>` : ''}
    </div>
    <div class="card">
      <div class="card-head"><h3>🧩 团员画像</h3>${member.portrait_updated_at ? `<span class="muted" style="font-size:12px">更新于 ${fmtDate(member.portrait_updated_at)}</span>` : ''}</div>
      ${renderPortraitBody(p)}
    </div>`;
}

function renderPortraitBody(p) {
  if (!p) return '<div class="empty">尚未生成画像，点击上方「生成画像」按钮，AI 将根据自我介绍与管理员补充自动总结。</div>';
  const lists = (arr, cls) => arr && arr.length ? arr.map((x) => `<span class="${cls}">${esc(x)}</span>`).join('') : '';
  return `
    ${p.summary ? `<div class="summary" style="font-size:14px;background:var(--primary-light);padding:12px 14px;border-radius:8px">${esc(p.summary)}</div>` : ''}
    ${p.personality && p.personality.length ? `<div class="section"><div class="t">性格特征</div>${lists(p.personality, 'tag')}</div>` : ''}
    ${p.interests && p.interests.length ? `<div class="section"><div class="t">兴趣偏好</div>${lists(p.interests, 'tag green')}</div>` : ''}
    ${p.strengths && p.strengths.length ? `<div class="section"><div class="t">优势特长</div>${lists(p.strengths, 'tag orange')}</div>` : ''}
    ${p.volunteer_style ? `<div class="section"><div class="t">志愿服务倾向</div><div>${esc(p.volunteer_style)}</div></div>` : ''}
    ${p.role_suggestion ? `<div class="section"><div class="t">组织角色建议</div><div>${esc(p.role_suggestion)}</div></div>` : ''}
    ${p.tags && p.tags.length ? `<div class="section"><div class="t">画像标签</div>${lists(p.tags, 'tag')}</div>` : ''}
    ${p.fallback_reason ? `<div class="help mt">⚠ ${esc(p.fallback_reason)}</div>` : ''}
  `;
}

async function delMember(id, name) {
  if (!confirm(`确定删除团员「${name}」吗？此操作不可恢复。`)) return;
  try {
    await api('DELETE', 'members/' + id);
    toast('已删除');
    route();
  } catch (e) { toast(e.message, 'err'); }
}

async function openMemberModal(id) {
  let member = null;
  if (id) ({ member } = await api('GET', 'members/' + id));
  openModal(modalHtml(id ? '编辑团员' : '添加团员', memberFormHtml(member),
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="saveMemberBtn">保存</button>`));
  syncLeagueSection();
  const statusEl = document.getElementById('fld_political_status');
  if (statusEl) statusEl.addEventListener('change', syncLeagueSection);
  $('#saveMemberBtn').addEventListener('click', async () => {
    const body = collectMemberForm();
    if (!body.name) { toast('请填写姓名', 'err'); return; }
    try {
      if (id) await api('PUT', 'members/' + id, body);
      else await api('POST', 'members', body);
      toast('保存成功');
      closeModal();
      route();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function openImportModal() {
  openModal(modalHtml('导入团员数据', `
    <p class="muted">方式一：直接粘贴 CSV 内容（首行为表头，需包含 name 列）。<br>方式二：选择本地 CSV 文件。</p>
    <input type="file" id="csvFile" accept=".csv" class="mb">
    <textarea id="csvText" style="min-height:160px" placeholder="name,gender,student_no,email,hobbies&#10;张三,男,2023001,zhang@example.com,篮球,读书"></textarea>
    <div class="help">可用列：name, gender, birth_date, nation, native_place, political_status, join_league_date, org_name, phone, email, student_no, major, league_no, league_role, hobbies, specialties, skills, volunteer_willing, volunteer_types, self_intro, admin_notes, tags（org_name 即「所属导师组」）</div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="doImport">导入</button>`), true);
  $('#csvFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { $('#csvText').value = reader.result; };
    reader.readAsText(f);
  });
  $('#doImport').addEventListener('click', async () => {
    const csv = $('#csvText').value.trim();
    if (!csv) { toast('请粘贴或选择 CSV', 'err'); return; }
    try {
      const r = await api('POST', 'members/import', { csv });
      toast(`导入成功 ${r.imported} 条${r.skipped ? `，跳过 ${r.skipped} 条` : ''}`);
      closeModal();
      route();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ============================ AI 画像生成 ============================ */
async function genOnePortrait(id, btn) {
  if (btn) { btn.disabled = true; const o = btn.innerHTML; btn.innerHTML = '<span class="spin">↻</span> 生成中…'; }
  try {
    const r = await api('POST', `members/${id}/portrait`);
    toast(r.portrait && r.portrait.fallback_reason ? '已用规则画像生成（AI 未配置或失败）' : '画像已生成');
    route();
  } catch (e) {
    toast(e.message, 'err');
    if (btn) btn.disabled = false;
  }
}

async function runPortraitBatch(ids, label) {
  openModal(modalHtml('批量生成画像', `
    <div id="batchProgress">准备中…</div>
    <div class="progress-bar" style="height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-top:12px"><div id="batchBar" style="height:100%;width:0;background:var(--primary);transition:.3s"></div></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">关闭</button>`), true);
  let ok = 0, fail = 0;
  for (let i = 0; i < ids.length; i++) {
    $('#batchProgress').innerHTML = `正在生成第 ${i + 1} / ${ids.length} 个团员画像…`;
    $('#batchBar').style.width = `${((i + 1) / ids.length) * 100}%`;
    try {
      await api('POST', `members/${ids[i]}/portrait`);
      ok++;
    } catch { fail++; }
  }
  $('#batchProgress').innerHTML = `完成：成功 ${ok} 个，失败 ${fail} 个`;
  $('#batchBar').style.width = '100%';
  toast(`${label}画像生成完成`);
  route();
}

/* ============================ 团员画像列表 ============================ */
async function renderPortraits(c) {
  const { members } = await api('GET', 'members');
  const todo = members.filter((m) => !m.portrait);
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">共 ${members.length} 名团员，已生成画像 ${members.length - todo.length} 人</span>
      <div class="spacer"></div>
      <button class="btn btn-outline" id="genAll">✨ 为未生成画像的全部团员批量生成</button>
    </div>
    <div class="portrait-grid">
      ${members.map((m) => `
        <div class="portrait-card">
          <div class="head">
            <div class="name"><a href="#/members/${m.id}">${esc(m.name)}</a></div>
            ${m.portrait ? '<span class="badge ok">已生成</span>' : '<span class="badge no">未生成</span>'}
          </div>
          <div class="meta">${esc(m.league_role || '普通团员')} · ${esc(m.major || '')}</div>
          <div class="meta">${volTag(m.volunteer_willing)}</div>
          ${m.portrait_obj ? `<div class="summary">${esc(m.portrait_obj.summary || '')}</div>` : '<div class="empty" style="padding:14px 0">尚未生成</div>'}
          ${m.portrait_obj && m.portrait_obj.tags && m.portrait_obj.tags.length ? `<div class="section"><div class="t">标签</div>${m.portrait_obj.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="mt"><button class="btn btn-ghost btn-sm" onclick="genOnePortrait(${m.id}, this)">${m.portrait ? '重新生成' : '生成画像'}</button></div>
        </div>`).join('') || '<div class="empty">暂无团员</div>'}
    </div>`;
  $('#genAll').addEventListener('click', () => {
    if (!todo.length) { toast('所有团员均已生成画像'); return; }
    runPortraitBatch(todo.map((m) => m.id), '批量');
  });
}

/* ============================ 数字画像 ============================ */
async function renderBranch(c) {
  const { stats } = await api('GET', 'branch-stats');
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">基于 ${stats.total} 名团员的实时统计（纯本地规则计算）</span>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="genGuidance">🤖 AI 生成团支书工作建议</button>
    </div>
    <div class="grid-2">
      <div class="chart-box"><h4>性别分布</h4><div id="bGender"></div></div>
      <div class="chart-box"><h4>年龄分布</h4><div id="bAge"></div></div>
    </div>
    <div class="grid-2">
      <div class="chart-box"><h4>热门兴趣爱好 TOP</h4><div id="bHobby"></div></div>
      <div class="chart-box"><h4>优势特长 TOP</h4><div id="bSpec"></div></div>
    </div>
    <div class="grid-2">
      <div class="chart-box"><h4>志愿服务意愿</h4><div id="bVol"></div></div>
      <div class="chart-box"><h4>政治面貌分布</h4><div id="bPol"></div></div>
    </div>
    <div class="grid-2">
      <div class="chart-box"><h4>团内职务分布</h4><div id="bRole"></div></div>
      <div class="chart-box"><h4>活动类型分布</h4><div id="bAct"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>💪 愿意作为志愿者参与组织活动的团员（${stats.willing_count} 人）</h3></div>
      ${stats.willing_names.length ? `<div class="rows">${stats.willing_names.map((n) => `<span class="tag green">${esc(n)}</span>`).join('')}</div>` : '<div class="empty">暂无明确标注愿意参与的团员</div>'}
      ${stats.volunteer_type_tags.length ? `<div class="mt"><strong>志愿类型分布：</strong>${stats.volunteer_type_tags.map((t) => `<span class="tag">${esc(t.name)} ×${t.value}</span>`).join('')}</div>` : ''}
    </div>
    <div id="guidanceBox"></div>`;

  ChartX.renderPie($('#bGender'), stats.gender, { donut: true, centerText: stats.total });
  ChartX.renderBars($('#bAge'), stats.age, { height: 200 });
  ChartX.renderHBars($('#bHobby'), stats.hobbies);
  ChartX.renderHBars($('#bSpec'), stats.specialties);
  ChartX.renderBars($('#bVol'), stats.volunteer_willing, { height: 200 });
  ChartX.renderPie($('#bPol'), stats.political_status, { donut: true });
  ChartX.renderHBars($('#bRole'), stats.league_role);
  ChartX.renderPie($('#bAct'), stats.activity_types, { donut: true });

  $('#genGuidance').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> AI 分析中…';
    const box = $('#guidanceBox');
    box.innerHTML = '<div class="card"><div class="loading">AI 正在分析团支部数字画像，请稍候…</div></div>';
    try {
      const r = await api('POST', 'branch-guidance');
      box.innerHTML = renderGuidance(r.guidance);
      toast('AI 分析完成');
    } catch (e) {
      box.innerHTML = `<div class="card"><div class="empty">AI 分析失败：${esc(e.message)}。请检查「系统设置」中的 AI 配置。</div></div>`;
      toast(e.message, 'err');
    } finally { btn.disabled = false; btn.innerHTML = '🤖 AI 生成团支书工作建议'; }
  });
}

function renderGuidance(g) {
  return `<div class="card">
    <div class="card-head"><h3>🤖 团支书工作建议</h3></div>
    <p style="font-size:14px">${esc(g.overview || '')}</p>
    ${g.highlights && g.highlights.length ? `<div class="mt"><strong>突出特点：</strong>${g.highlights.map((x) => `<span class="highlight-pill">${esc(x)}</span>`).join('')}</div>` : ''}
    ${g.suggestions && g.suggestions.length ? `<div class="mt"><strong>工作建议：</strong></div><div class="mt">${g.suggestions.map((s) => `<div class="suggest-card"><div class="t">${esc(s.title)}</div><div>${esc(s.detail)}</div></div>`).join('')}</div>` : ''}
    ${g.risk_points && g.risk_points.length ? `<div class="mt"><strong>需关注/改进：</strong>${g.risk_points.map((x) => `<span class="risk-pill">${esc(x)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/* ============================ 团费收缴 ============================ */
async function renderFees(c, param) {
  if (param && /^\d+$/.test(param)) return renderFeeDetail(c, Number(param));
  const { periods } = await api('GET', 'fees');
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">共 ${periods.length} 期团费收缴</span>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="newFee">＋ 发起收缴</button>
    </div>
    <div class="fee-grid">
      ${periods.map((p) => feePeriodCardHtml(p)).join('') || '<div class="empty">暂无收缴记录，点击「发起收缴」开始</div>'}
    </div>`;
  $('#newFee').addEventListener('click', () => openFeePeriodModal());
}

function feePeriodCardHtml(p) {
  const pct = p.total ? Math.round(((p.paid + p.exempt) / p.total) * 100) : 0;
  const done = p.status === '已完成';
  return `<a class="fee-card" href="#/fees/${p.id}">
    <div class="fee-top">
      <div class="fee-title">${esc(p.period)}</div>
      <span class="badge ${done ? 'ok' : 'sent'}">${esc(p.status)}</span>
    </div>
    <div class="fee-meta">${p.amount} 元/人 · 已缴 ${p.paid} · 免缴 ${p.exempt} · 未缴 ${p.unpaid} · 共 ${p.total} 人</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
  </a>`;
}

async function renderFeeDetail(c, id) {
  const { period, summary, records } = await api('GET', 'fees/' + id);
  const pct = summary.total ? Math.round(((summary.paid + summary.exempt) / summary.total) * 100) : 0;
  c.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${esc(period.period)} <span class="badge ${period.status === '已完成' ? 'ok' : 'sent'}" id="feeStatusBadge">${esc(period.status)}</span></h3>
        <div class="rows">
          <button class="btn btn-outline" id="feeNotify">✉️ 通知</button>
          <button class="btn btn-ghost" id="feeEdit">编辑</button>
          <button class="btn btn-danger" id="feeDel">删除</button>
          <button class="btn btn-ghost" onclick="location.hash='#/fees'">← 返回</button>
        </div>
      </div>
      <div class="fee-summary">
        <div><div class="label">金额</div><div class="value">${period.amount} 元/人</div></div>
        <div><div class="label">已缴</div><div class="value green" id="feePaid">${summary.paid}</div></div>
        <div><div class="label">免缴</div><div class="value" id="feeExempt">${summary.exempt}</div></div>
        <div><div class="label">未缴</div><div class="value red" id="feeUnpaid">${summary.unpaid}</div></div>
        <div><div class="label">总人数</div><div class="value" id="feeTotal">${summary.total}</div></div>
      </div>
      ${period.note ? `<div class="mt muted">说明：${esc(period.note)}</div>` : ''}
      <div class="progress-bar mt"><div class="progress-fill" id="feeProgress" style="width:${pct}%"></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>缴纳情况登记</h3></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>姓名</th><th>学号</th><th>政治面貌</th><th>缴纳状态</th><th>订单号</th><th>更新时间</th></tr></thead>
        <tbody>${records.map((r) => `
          <tr>
            <td>${esc(r.name)}</td>
            <td>${esc(r.student_no) || '—'}</td>
            <td>${esc(r.political_status) || '—'}</td>
            <td><select class="fee-status" data-id="${r.record_id}">${['未缴', '已缴', '免缴'].map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
            <td><input type="text" class="fee-order" data-id="${r.record_id}" value="${esc(r.order_no)}" placeholder="填写订单号"></td>
            <td>${fmtDate(r.updated_at)}</td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无缴纳对象</td></tr>'}</tbody>
      </table></div>
      <div class="help mt">修改状态或订单号后自动保存；所有团员标记为「已缴/免缴」后，该期自动变为「已完成」。</div>
    </div>`;

  $$('.fee-status').forEach((sel) => sel.addEventListener('change', () => saveFeeRecord(sel.dataset.id, sel.value)));
  $$('.fee-order').forEach((inp) => inp.addEventListener('change', () => saveFeeRecord(inp.dataset.id, undefined, inp.value)));
  $('#feeNotify').addEventListener('click', () => openFeeNotifyModal(id));
  $('#feeEdit').addEventListener('click', () => openFeePeriodModal(id));
  $('#feeDel').addEventListener('click', async () => {
    if (!confirm('确定删除该期收缴及其所有登记记录？')) return;
    try { await api('DELETE', 'fees/' + id); toast('已删除'); location.hash = '#/fees'; }
    catch (e) { toast(e.message, 'err'); }
  });
}

async function saveFeeRecord(recordId, status, orderNo) {
  try {
    const body = {};
    if (status !== undefined) body.status = status;
    if (orderNo !== undefined) body.order_no = orderNo;
    const r = await api('PUT', 'fees/records/' + recordId, body);
    if (r.summary) {
      const s = r.summary;
      const set = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
      set('#feePaid', s.paid); set('#feeExempt', s.exempt); set('#feeUnpaid', s.unpaid); set('#feeTotal', s.total);
      const badge = $('#feeStatusBadge');
      if (badge) { badge.textContent = s.done ? '已完成' : '收缴中'; badge.className = 'badge ' + (s.done ? 'ok' : 'sent'); }
      const bar = $('#feeProgress');
      if (bar) bar.style.width = (s.total ? Math.round(((s.paid + s.exempt) / s.total) * 100) : 0) + '%';
      if (s.done) toast('该期团费已全部收缴完成 🎉');
    }
  } catch (e) { toast(e.message, 'err'); }
}

async function openFeePeriodModal(id) {
  let period = null;
  if (id) {
    const d = await api('GET', 'fees/' + id);
    period = d.period;
  }
  openModal(modalHtml(id ? '编辑收缴期数' : '发起团费收缴', `
    <form class="form-grid">
      <div class="form-item full"><label>期数名称 *</label><input type="text" id="fPeriod" placeholder="例如：2026年第一季度团费" value="${esc(period?.period || '')}"></div>
      <div class="form-item"><label>金额（元/人）*</label><input type="number" step="0.01" min="0" id="fAmount" value="${esc(period?.amount ?? '')}"></div>
      <div class="form-item full"><label>说明</label><textarea id="fNote">${esc(period?.note || '')}</textarea></div>
    </form>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="saveFee">保存</button>`), true);
  $('#saveFee').addEventListener('click', async () => {
    const body = { period: $('#fPeriod').value.trim(), amount: $('#fAmount').value, note: $('#fNote').value };
    if (!body.period) { toast('请填写期数名称', 'err'); return; }
    try {
      if (id) { await api('PUT', 'fees/' + id, body); toast('已保存'); closeModal(); route(); }
      else { const r = await api('POST', 'fees', body); toast('已发起收缴'); closeModal(); location.hash = '#/fees/' + r.id; }
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function openFeeNotifyModal(id) {
  const draft = await api('GET', `fees/${id}/draft`);
  openModal(modalHtml('团费收缴通知', `
    <div class="form-item full"><label>邮件主题</label><input type="text" id="nfSubject" value="${esc(draft.subject)}"></div>
    <div class="form-item full"><label>邮件正文（可编辑，换行会保留）</label><textarea id="nfText" style="min-height:220px">${esc(draft.text)}</textarea></div>
    <div class="help">邮件将发送给本期所有缴纳对象（已填写邮箱的团员）。</div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="sendFeeNotify">发送通知</button>`));
  $('#sendFeeNotify').addEventListener('click', async () => {
    const btn = $('#sendFeeNotify'); btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> 发送中…';
    try {
      const r = await api('POST', `fees/${id}/notify`, { subject: $('#nfSubject').value, text: $('#nfText').value });
      toast(`已向 ${r.count} 位团员发送通知`);
      closeModal(); route();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = '发送通知'; }
  });
}

/* ============================ 活动管理 ============================ */
async function renderActivities(c) {
  const { activities } = await api('GET', 'activities');
  const { members } = await api('GET', 'members');
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">共 ${activities.length} 个活动</span>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="newAct">＋ 新建活动</button>
    </div>
    <div id="actList">${activities.map((a) => activityCardHtml(a, members)).join('') || '<div class="empty">暂无活动，点击「新建活动」创建</div>'}</div>`;

  $('#newAct').addEventListener('click', () => openActivityModal(members));
  $$('#actList [data-edit]').forEach((b) => b.addEventListener('click', () => openActivityModal(members, Number(b.dataset.edit))));
  $$('#actList [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除该活动？')) return;
    await api('DELETE', 'activities/' + b.dataset.del);
    toast('已删除'); route();
  }));
  $$('#actList [data-notify]').forEach((b) => b.addEventListener('click', async () => {
    const btn = b; btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> 发送中…';
    try {
      const r = await api('POST', `activities/${btn.dataset.notify}/notify`);
      toast(`已向 ${r.count} 位团员发送通知`);
      route();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = '✉️ 一键通知'; }
  }));
}

function activityCardHtml(a, members) {
  const partNames = (a.participants || []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  const sent = a.notify_status === '已通知';
  return `<div class="activity-card">
    <div class="top">
      <div>
        <div class="title">${esc(a.title)}</div>
        <div class="info"><span class="badge ok">${esc(a.type)}</span> ${a.start_time ? '📅 ' + esc(a.start_time) : ''} ${a.location ? '📍 ' + esc(a.location) : ''}</div>
      </div>
      <div class="ops">
        <button class="btn btn-ghost btn-sm" data-edit="${a.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-notify="${a.id}">✉️ 一键通知</button>
        <button class="btn btn-danger btn-sm" data-del="${a.id}">删除</button>
      </div>
    </div>
    ${a.description ? `<div class="desc">${esc(a.description)}</div>` : ''}
    <div class="info mt">参与人员（${partNames.length} 人）：${partNames.map((n) => `<span class="tag">${esc(n)}</span>`).join('') || '<span class="muted">未添加</span>'}</div>
    <div class="info mt">通知状态：${sent ? '<span class="badge sent">已通知</span>' : '<span class="badge no">未通知</span>'}</div>
  </div>`;
}

async function openActivityModal(members, id) {
  let a = null;
  if (id) {
    const { activities } = await api('GET', 'activities');
    a = activities.find((x) => x.id === id);
  }
  openModal(modalHtml(id ? '编辑活动' : '新建活动', `
    <form id="actForm" class="form-grid">
      <div class="form-item full"><label>活动标题 *</label><input type="text" id="aTitle" value="${esc(a?.title || '')}"></div>
      <div class="form-item"><label>活动类型</label><select id="aType">${['团日活动', '志愿服务', '组织生活会', '学习培训', '文体活动', '其他'].map((t) => `<option ${a?.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-item"><label>地点</label><input type="text" id="aLoc" value="${esc(a?.location || '')}"></div>
      <div class="form-item"><label>开始时间</label><input type="datetime-local" id="aStart" value="${esc(a?.start_time || '')}"></div>
      <div class="form-item"><label>结束时间</label><input type="datetime-local" id="aEnd" value="${esc(a?.end_time || '')}"></div>
      <div class="form-item full"><label>活动内容</label><textarea id="aDesc">${esc(a?.description || '')}</textarea></div>
      <div class="form-item full">
        <label>参与人员（勾选后可通过邮件一键通知）</label>
        <div class="search-sel">
          ${members.map((m) => `<label class="checkbox-wrap"><input type="checkbox" class="aPart" value="${m.id}" ${(a?.participants || []).includes(m.id) ? 'checked' : ''}> ${esc(m.name)}${m.email ? '' : '<span style="color:#ccc">(无邮箱)</span>'}</label>`).join('')}
        </div>
      </div>
    </form>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="saveAct">保存</button>`));
  $('#saveAct').addEventListener('click', async () => {
    const body = {
      title: $('#aTitle').value,
      type: $('#aType').value,
      location: $('#aLoc').value,
      start_time: $('#aStart').value,
      end_time: $('#aEnd').value,
      description: $('#aDesc').value,
      participants: $$('.aPart:checked').map((x) => Number(x.value)),
    };
    if (!body.title) { toast('请填写活动标题', 'err'); return; }
    try {
      if (id) await api('PUT', 'activities/' + id, body);
      else await api('POST', 'activities', body);
      toast('保存成功'); closeModal(); route();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ============================ 邮件通知 ============================ */
async function renderEmail(c) {
  const { members } = await api('GET', 'members');
  const withEmail = members.filter((m) => m.email);
  const { logs } = await api('GET', 'email/logs');
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>✉️ 发送邮件</h3></div>
        <form id="mailForm" class="form-grid">
          <div class="form-item full"><label>收件人（勾选有邮箱的团员，或手动输入，用逗号分隔）</label>
            <div class="search-sel mb">
              <label class="checkbox-wrap"><input type="checkbox" id="selAllMail"> 全选（${withEmail.length} 人）</label>
              ${withEmail.map((m) => `<label class="checkbox-wrap"><input type="checkbox" class="mailTo" value="${esc(m.email)}"> ${esc(m.name)} <span style="color:#bbb">${esc(m.email)}</span></label>`).join('')}
            </div>
            <input type="text" id="mailToCustom" placeholder="或手动输入邮箱，逗号分隔">
          </div>
          <div class="form-item full"><label>主题 *</label><input type="text" id="mailSubject" placeholder="例如：关于开展主题团日活动的通知"></div>
          <div class="form-item full"><label>正文（支持换行）</label><textarea id="mailBody" style="min-height:160px"></textarea></div>
          <div class="form-item full">
            <button type="button" class="btn btn-primary" id="sendMailBtn">发送邮件</button>
            <button type="button" class="btn btn-ghost" id="testMailBtn" style="margin-left:8px">发送测试邮件</button>
          </div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h3>📤 发送记录</h3></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>主题</th><th>收件人</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${logs.map((l) => `<tr>
            <td>${esc(l.subject)}</td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(l.to_list)}">${esc(l.to_list)}</td>
            <td>${l.status === '成功' ? '<span class="badge ok">成功</span>' : `<span class="badge err" title="${esc(l.error)}">失败</span>`}</td>
            <td>${fmtDate(l.sent_at)}</td>
          </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无发送记录</td></tr>'}</tbody>
        </table></div>
        <div class="help mt">提示：请先在「系统设置」中配置 SMTP 邮箱，再发送邮件。</div>
      </div>
    </div>`;

  $('#selAllMail').addEventListener('change', (e) => { $$('.mailTo').forEach((x) => { x.checked = e.target.checked; }); });

  function collectRecipients() {
    const set = new Set();
    $$('.mailTo:checked').forEach((x) => set.add(x.value));
    ($('#mailToCustom').value || '').split(/[,;，；]/).map((s) => s.trim()).filter(Boolean).forEach((s) => set.add(s));
    return Array.from(set);
  }

  $('#sendMailBtn').addEventListener('click', async () => {
    const to = collectRecipients();
    const subject = $('#mailSubject').value.trim();
    const text = $('#mailBody').value.trim();
    if (!to.length) { toast('请选择或输入收件人', 'err'); return; }
    if (!subject) { toast('请填写主题', 'err'); return; }
    const btn = $('#sendMailBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> 发送中…';
    try {
      const r = await api('POST', 'email/send', { to, subject, text });
      toast(`已发送给 ${to.length} 个邮箱`); route();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = '发送邮件'; }
  });

  $('#testMailBtn').addEventListener('click', async () => {
    const to = collectRecipients()[0];
    const btn = $('#testMailBtn'); btn.disabled = true;
    try {
      const r = await api('POST', 'email/test', { to });
      toast('测试邮件发送成功'); btn.disabled = false;
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  });
}

/* ============================ 智慧团建 ============================ */
async function renderZhtj(c) {
  const { base_url, routes } = await api('GET', 'zhtj/routes');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>🔗 智慧团建对接</h3><a href="#/settings">维护路由表 →</a></div>
      <p class="muted">智慧团建系统网址：<a href="${esc(base_url)}" target="_blank" rel="noopener">${esc(base_url)}</a>。官方无公开 API，本平台采用超链接形式跳转到对应功能入口（在新标签页打开，需在智慧团建中登录）。</p>
    </div>
    <div class="zhtj-grid">
      ${routes.map((r) => `<a class="zhtj-card" href="${esc(r.url)}" target="_blank" rel="noopener">
        <div class="n">${esc(r.name)}</div>
        <div class="d">${esc(r.desc || '')}</div>
        <div class="go">前往 →</div>
      </a>`).join('') || '<div class="empty">尚未配置路由</div>'}
    </div>`;
}

/* ============================ 设置 ============================ */
async function renderSettings(c) {
  const s = await api('GET', 'settings');
  c.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>🏛 站点信息</h3></div>
        <div class="form-grid">
          <div class="form-item full"><label>平台名称</label><input type="text" id="sName" value="${esc(s.site_name)}"></div>
          <div class="form-item full"><label>团支部名称</label><input type="text" id="sOrg" value="${esc(s.org_name)}"></div>
          <div class="form-item full"><label>修改管理员密码（留空则不修改）</label><input type="password" id="sPwd" placeholder="输入新密码"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>📧 SMTP 邮件配置</h3><button class="btn btn-ghost btn-sm" id="smtpTest">发送测试邮件</button></div>
        <div class="form-grid">
          <div class="form-item"><label>SMTP 服务器</label><input type="text" id="smtpHost" placeholder="smtp.qq.com" value="${esc(s.smtp_host)}"></div>
          <div class="form-item"><label>端口</label><input type="number" id="smtpPort" value="${esc(s.smtp_port)}"></div>
          <div class="form-item"><label>加密方式</label><select id="smtpSecure"><option value="1" ${s.smtp_secure === '1' ? 'selected' : ''}>SSL/TLS (465)</option><option value="0" ${s.smtp_secure === '0' ? 'selected' : ''}>STARTTLS/明文 (587/25)</option></select></div>
          <div class="form-item"><label>账号</label><input type="text" id="smtpUser" value="${esc(s.smtp_user)}"></div>
          <div class="form-item"><label>授权码/密码 ${s.smtp_pass_set ? '<span class="tag green">已配置</span>' : ''}</label><input type="password" id="smtpPass" placeholder="${s.smtp_pass_set ? '留空保持不变' : '输入授权码'}"></div>
          <div class="form-item"><label>发件地址</label><input type="email" id="smtpFrom" value="${esc(s.smtp_from)}"></div>
          <div class="form-item"><label>发件人名称</label><input type="text" id="smtpFromName" value="${esc(s.smtp_from_name)}"></div>
        </div>
        <div class="help">QQ邮箱：smtp.qq.com:465；163邮箱：smtp.163.com:465；Gmail：smtp.gmail.com:465。需在邮箱设置中开启 SMTP 并获取授权码。</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>🤖 AI 配置（生成画像与建议）</h3><button class="btn btn-ghost btn-sm" id="aiTest">测试连接</button></div>
        <div class="form-grid">
          <div class="form-item"><label>接口类型</label><select id="aiProvider"><option value="openai" ${s.ai_provider === 'openai' ? 'selected' : ''}>OpenAI 兼容</option><option value="ollama" ${s.ai_provider === 'ollama' ? 'selected' : ''}>Ollama 原生</option></select></div>
          <div class="form-item"><label>接口地址</label><input type="text" id="aiBase" placeholder="https://api.deepseek.com/v1" value="${esc(s.ai_base_url)}"></div>
          <div class="form-item"><label>模型</label><input type="text" id="aiModel" placeholder="deepseek-chat" value="${esc(s.ai_model)}"></div>
          <div class="form-item"><label>API Key ${s.ai_api_key_set ? '<span class="tag green">已配置</span>' : ''}</label><input type="password" id="aiKey" placeholder="${s.ai_api_key_set ? '留空保持不变' : '输入 API Key'}"></div>
          <div class="form-item"><label>温度 (0-1)</label><input type="number" step="0.1" min="0" max="1" id="aiTemp" value="${esc(s.ai_temperature)}"></div>
        </div>
        <div class="help">支持 DeepSeek、OpenAI、通义、智谱、Kimi、Ollama 本地模型等。OpenAI 兼容地址需以 /v1 结尾。本地部署无 Key 时可用 Ollama。</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>🔗 智慧团建路由表</h3></div>
        <div class="form-item full"><label>智慧团建基础网址</label><input type="text" id="zhtjBase" value="${esc(s.zhtj_base_url)}"></div>
        <div id="routeList" class="mt">${(s.zhtj_routes || []).map((r, i) => `
          <div class="form-grid" style="margin-bottom:8px" data-ri="${i}">
            <div class="form-item"><input type="text" class="rName" placeholder="功能名称" value="${esc(r.name)}"></div>
            <div class="form-item"><input type="text" class="rUrl" placeholder="URL" value="${esc(r.url)}"></div>
            <div class="form-item"><input type="text" class="rDesc" placeholder="说明" value="${esc(r.desc || '')}"></div>
            <div class="form-item" style="flex-direction:row;align-items:center"><button type="button" class="btn btn-danger btn-sm delRoute">删除</button></div>
          </div>`).join('')}</div>
        <button class="btn btn-ghost btn-sm" id="addRoute">＋ 添加路由</button>
      </div>
    </div>
    <div class="card"><button class="btn btn-primary" id="saveSettings" style="width:100%;justify-content:center">保存全部设置</button></div>`;

  $('#smtpTest').addEventListener('click', async () => { await saveSettings(false); const r = await api('POST', 'email/test', { to: '' }); r.ok ? toast('测试邮件发送成功') : toast(r.message, 'err'); });
  $('#aiTest').addEventListener('click', async () => {
    await saveSettings(false);
    const btn = $('#aiTest'); btn.disabled = true;
    try {
      const r = await api('POST', 'ai/test');
      toast(r.message || 'AI 连接正常');
    } catch (e) {
      toast(e.message, 'err');
    } finally { btn.disabled = false; }
  });

  $('#addRoute').addEventListener('click', () => {
    const idx = $$('#routeList [data-ri]').length;
    $('#routeList').insertAdjacentHTML('beforeend', `<div class="form-grid" style="margin-bottom:8px" data-ri="${idx}">
      <div class="form-item"><input type="text" class="rName" placeholder="功能名称"></div>
      <div class="form-item"><input type="text" class="rUrl" placeholder="URL"></div>
      <div class="form-item"><input type="text" class="rDesc" placeholder="说明"></div>
      <div class="form-item" style="flex-direction:row;align-items:center"><button type="button" class="btn btn-danger btn-sm delRoute">删除</button></div>
    </div>`);
    bindRouteDel();
  });
  bindRouteDel();
  function bindRouteDel() {
    $$('#routeList .delRoute').forEach((b) => b.addEventListener('click', () => b.closest('[data-ri]').remove()));
  }

  $('#saveSettings').addEventListener('click', () => saveSettings(true));
}

async function saveSettings(showToastMsg = true) {
  const routes = $$('#routeList [data-ri]').map((row) => ({
    name: row.querySelector('.rName').value.trim(),
    url: row.querySelector('.rUrl').value.trim(),
    desc: row.querySelector('.rDesc').value.trim(),
  })).filter((r) => r.name);
  const body = {
    site_name: $('#sName').value,
    org_name: $('#sOrg').value,
    smtp_host: $('#smtpHost').value,
    smtp_port: $('#smtpPort').value,
    smtp_secure: $('#smtpSecure').value,
    smtp_user: $('#smtpUser').value,
    smtp_from: $('#smtpFrom').value,
    smtp_from_name: $('#smtpFromName').value,
    smtp_pass: $('#smtpPass').value || undefined,
    ai_provider: $('#aiProvider').value,
    ai_base_url: $('#aiBase').value,
    ai_model: $('#aiModel').value,
    ai_temperature: $('#aiTemp').value,
    ai_api_key: $('#aiKey').value || undefined,
    zhtj_base_url: $('#zhtjBase').value,
    zhtj_routes: routes,
    admin_password: $('#sPwd').value || undefined,
  };
  try {
    await api('PUT', 'settings', body);
    if (showToastMsg) { toast('设置已保存'); route(); }
  } catch (e) { toast(e.message, 'err'); }
}

/* ============================ 信息发布 ============================ */
const POST_CATEGORIES = ['通知', '公示', '活动', '学习', '其他'];

async function renderPosts(c) {
  const { posts } = await api('GET', 'posts');
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">共 ${posts.length} 篇内容，发布后团员可在网页端查看</span>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="newPost">＋ 新建信息</button>
    </div>
    <div id="postList">${posts.length ? posts.map(postCardHtml).join('') : '<div class="empty">暂无内容，点击「新建信息」创建</div>'}</div>`;
  $('#newPost').addEventListener('click', () => openPostModal());
  $$('#postList [data-edit]').forEach((b) => b.addEventListener('click', () => openPostModal(Number(b.dataset.edit))));
  $$('#postList [data-pub]').forEach((b) => b.addEventListener('click', async () => { await api('POST', `posts/${b.dataset.pub}/publish`); toast('已发布'); route(); }));
  $$('#postList [data-unpub]').forEach((b) => b.addEventListener('click', async () => { await api('POST', `posts/${b.dataset.unpub}/unpublish`); toast('已下架'); route(); }));
  $$('#postList [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除该内容？')) return;
    await api('DELETE', 'posts/' + b.dataset.del); toast('已删除'); route();
  }));
}

function postCardHtml(p) {
  const st = p.status === 'published' ? '<span class="badge ok">已发布</span>' : '<span class="badge no">草稿</span>';
  return `<div class="activity-card">
    <div class="top"><div>
      <div class="title">${p.is_pinned ? '📌 ' : ''}${esc(p.title)} ${st}</div>
      <div class="info">${esc(p.category || '通知')} · ${p.published_at ? '发布于 ' + esc(fmtDate(p.published_at)) : '未发布'}</div>
    </div>
    <div class="ops">
      <button class="btn btn-ghost btn-sm" data-edit="${p.id}">编辑</button>
      ${p.status === 'published' ? `<button class="btn btn-ghost btn-sm" data-unpub="${p.id}">下架</button>` : `<button class="btn btn-ghost btn-sm" data-pub="${p.id}">发布</button>`}
      <button class="btn btn-danger btn-sm" data-del="${p.id}">删除</button>
    </div></div>
  </div>`;
}

async function openPostModal(id) {
  let post = null;
  if (id) {
    const { posts } = await api('GET', 'posts');
    post = posts.find((x) => x.id === id);
  }
  openModal(modalHtml(id ? '编辑信息' : '新建信息', `
    <form class="form-grid">
      <div class="form-item full"><label>标题 *</label><input type="text" id="pTitle" value="${esc(post?.title || '')}"></div>
      <div class="form-item"><label>分类</label><select id="pCategory">${POST_CATEGORIES.map((t) => `<option ${post?.category === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-item"><label class="checkbox-wrap" style="margin-top:24px"><input type="checkbox" id="pPinned" ${post?.is_pinned ? 'checked' : ''}> 置顶</label></div>
      <div class="form-item full"><label>正文</label><textarea id="pContent" rows="10">${esc(post?.content || '')}</textarea></div>
    </form>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="savePost">保存</button>`));
  $('#savePost').addEventListener('click', async () => {
    const body = { title: $('#pTitle').value.trim(), category: $('#pCategory').value, content: $('#pContent').value, is_pinned: $('#pPinned').checked };
    if (!body.title) { toast('请填写标题', 'err'); return; }
    try {
      if (id) await api('PUT', 'posts/' + id, body); else await api('POST', 'posts', body);
      toast('保存成功'); closeModal(); route();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ============================ 投票管理 ============================ */
const POLL_VIS = { always: '实时可见', after_end: '结束后可见', never: '仅管理员' };

function pollStatusTag(s) {
  const m = { draft: ['草稿', 'no'], upcoming: ['未开始', 'no'], open: ['进行中', 'ok'], closed: ['已结束', 'no'] };
  const [label, cls] = m[s] || ['未知', 'no'];
  return `<span class="badge ${cls}">${label}</span>`;
}

async function renderPolls(c) {
  const { polls } = await api('GET', 'polls');
  c.innerHTML = `
    <div class="toolbar">
      <span class="muted">共 ${polls.length} 个投票，发布后团员以「姓名+学号」登录参与</span>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="newPoll">＋ 新建投票</button>
    </div>
    <div id="pollList">${polls.length ? polls.map(pollCardHtml).join('') : '<div class="empty">暂无投票，点击「新建投票」创建</div>'}</div>`;
  $('#newPoll').addEventListener('click', () => openPollModal());
  $$('#pollList [data-edit]').forEach((b) => b.addEventListener('click', () => openPollModal(Number(b.dataset.edit))));
  $$('#pollList [data-res]').forEach((b) => b.addEventListener('click', () => showPollResults(Number(b.dataset.res))));
  $$('#pollList [data-mail]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定将本次投票通过邮件发送给全体团员？')) return;
    const btn = b; const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin">↻</span> 发送中…';
    try {
      const r = await api('POST', `polls/${btn.dataset.mail}/notify`);
      toast(`已向 ${r.count} 位团员发送投票邮件`);
      btn.disabled = false; btn.innerHTML = old;
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = old; }
  }));
  $$('#pollList [data-pub]').forEach((b) => b.addEventListener('click', async () => { await api('POST', `polls/${b.dataset.pub}/publish`); toast('已发布'); route(); }));
  $$('#pollList [data-close]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('确定关闭该投票？')) return; await api('POST', `polls/${b.dataset.close}/close`); toast('已关闭'); route(); }));
  $$('#pollList [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('确定删除该投票？')) return;
    await api('DELETE', 'polls/' + b.dataset.del); toast('已删除'); route();
  }));
}

function pollCardHtml(p) {
  const typeTag = p.poll_type === 'multiple' ? `多选${p.multi_max > 1 ? '（最多 ' + p.multi_max + ' 项）' : ''}` : '单选';
  const anon = p.is_anonymous ? '匿名' : '实名';
  return `<div class="activity-card">
    <div class="top"><div>
      <div class="title">${esc(p.title)} ${pollStatusTag(p.effective_status)}</div>
      <div class="info"><span class="badge">${typeTag}</span> <span class="badge">${anon}</span> ${p.start_at ? '开始 ' + esc(fmtDate(p.start_at)) : '即时'} ${p.end_at ? '· 截止 ' + esc(fmtDate(p.end_at)) : ''}</div>
    </div>
    <div class="ops">
      <button class="btn btn-ghost btn-sm" data-edit="${p.id}">编辑</button>
      <button class="btn btn-ghost btn-sm" data-res="${p.id}">📊 结果</button>
      <button class="btn btn-ghost btn-sm" data-mail="${p.id}">✉️ 邮件发布</button>
      ${p.status === 'published' ? `<button class="btn btn-ghost btn-sm" data-close="${p.id}">关闭</button>` : `<button class="btn btn-ghost btn-sm" data-pub="${p.id}">发布</button>`}
      <button class="btn btn-danger btn-sm" data-del="${p.id}">删除</button>
    </div></div>
  </div>`;
}

async function openPollModal(id) {
  let poll = null;
  if (id) {
    const { poll: p } = await api('GET', 'polls/' + id);
    poll = p;
  }
  const options = (poll && poll.options && poll.options.length) ? poll.options : [{ text: '' }, { text: '' }];
  openModal(modalHtml(id ? '编辑投票' : '新建投票', `
    <form class="form-grid">
      <div class="form-item full"><label>投票标题 *</label><input type="text" id="vTitle" value="${esc(poll?.title || '')}"></div>
      <div class="form-item full"><label>投票说明</label><textarea id="vDesc" rows="3">${esc(poll?.description || '')}</textarea></div>
      <div class="form-item"><label>投票类型</label><select id="vType">
        <option value="single" ${poll?.poll_type !== 'multiple' ? 'selected' : ''}>单选</option>
        <option value="multiple" ${poll?.poll_type === 'multiple' ? 'selected' : ''}>多选</option>
      </select></div>
      <div class="form-item"><label>多选上限</label><input type="number" id="vMax" min="1" value="${poll?.multi_max || 1}"></div>
      <div class="form-item"><label>结果可见性</label><select id="vVis">${Object.entries(POLL_VIS).map(([k, v]) => `<option value="${k}" ${(poll?.result_visibility || 'always') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="form-item"><label>开始时间</label><input type="datetime-local" id="vStart" value="${esc(poll?.start_at || '')}"></div>
      <div class="form-item"><label>截止时间</label><input type="datetime-local" id="vEnd" value="${esc(poll?.end_at || '')}"></div>
      <div class="form-item full">
        <label class="checkbox-wrap"><input type="checkbox" id="vAnon" ${poll?.is_anonymous ? 'checked' : ''}> 匿名投票（不记录投票人）</label>
        <label class="checkbox-wrap" style="margin-left:16px"><input type="checkbox" id="vChange" ${poll?.allow_change_vote ? 'checked' : ''}> 允许改票</label>
      </div>
      <div class="form-item full"><label>选项（至少 2 个）</label>
        <div id="optList">${options.map((o, i) => `<div class="opt-row" style="display:flex;gap:8px;margin-bottom:6px"><input class="optText" type="text" value="${esc(o.text || '')}" placeholder="选项 ${i + 1}"><button type="button" class="btn btn-ghost btn-sm opt-del">×</button></div>`).join('')}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="addOpt">＋ 添加选项</button>
      </div>
    </form>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="savePoll">保存</button>`));

  $('#addOpt').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px';
    row.innerHTML = `<input class="optText" type="text" placeholder="选项 ${$$('#optList .opt-row').length + 1}"><button type="button" class="btn btn-ghost btn-sm opt-del">×</button>`;
    $('#optList').appendChild(row);
  });
  $('#optList').addEventListener('click', (e) => {
    if (e.target.classList.contains('opt-del')) {
      if ($$('#optList .opt-row').length > 2) e.target.closest('.opt-row').remove();
      else toast('至少保留 2 个选项', 'err');
    }
  });

  $('#savePoll').addEventListener('click', async () => {
    const opts = $$('#optList .optText').map((x) => ({ text: x.value.trim() })).filter((o) => o.text);
    const body = {
      title: $('#vTitle').value.trim(),
      description: $('#vDesc').value,
      poll_type: $('#vType').value,
      multi_max: Number($('#vMax').value) || 1,
      result_visibility: $('#vVis').value,
      is_anonymous: $('#vAnon').checked,
      allow_change_vote: $('#vChange').checked,
      start_at: $('#vStart').value || null,
      end_at: $('#vEnd').value || null,
      options: opts,
    };
    if (!body.title) { toast('请填写投票标题', 'err'); return; }
    if (opts.length < 2) { toast('至少填写 2 个选项', 'err'); return; }
    try {
      if (id) await api('PUT', 'polls/' + id, body); else await api('POST', 'polls', body);
      toast('保存成功'); closeModal(); route();
    } catch (e) { toast(e.message, 'err'); }
  });
}

async function showPollResults(id) {
  const { poll, participants, total_eligible, rate, counts, voters } = await api('GET', 'polls/' + id + '/results');
  const optMap = {};
  (poll.options || []).forEach((o) => { optMap[o.id] = o.text; });
  const total = (poll.options || []).reduce((s, o) => s + (counts?.[o.id] || 0), 0);
  const bars = (poll.options || []).map((o) => {
    const c = counts?.[o.id] || 0;
    const pct = total ? Math.round((c / total) * 1000) / 10 : 0;
    return `<div style="margin-bottom:12px">
      <div class="info" style="display:flex;justify-content:space-between"><span>${esc(o.text)}</span><span>${c} 票 · ${pct}%</span></div>
      <div style="background:#eef0f3;height:10px;border-radius:6px;overflow:hidden"><div style="width:${pct}%;height:10px;background:#c8102e"></div></div>
    </div>`;
  }).join('');
  const voterDetail = (voters && !poll.is_anonymous)
    ? `<div class="info mt">投票人明细：<br>${voters.map((v) => `<span class="tag">${esc(v.name)}（${esc(v.student_no)}）→ ${esc(optMap[v.option_id] || v.option_id)}</span>`).join(' ')}</div>`
    : '';
  openModal(modalHtml(`投票结果：${poll.title}`, `
    <div class="info mb">参与 ${participants} 人 · 应参与 ${total_eligible} 人 · 参与率 ${rate}%</div>
    ${bars}
    ${voterDetail}
    <div class="info mt"><a class="btn btn-ghost btn-sm" href="/api/polls/${id}/export" download>⬇ 导出 CSV</a></div>
  `));
}

/* ============================ 启动 ============================ */
window.openMemberModal = openMemberModal;
window.closeModal = closeModal;
window.delMember = delMember;
window.genOnePortrait = genOnePortrait;

window.addEventListener('hashchange', route);
$('#loginBtn').addEventListener('click', tryLogin);
$('#loginPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('#loginEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('#logoutBtn').addEventListener('click', async () => { await api('POST', 'auth/logout'); showLogin(); });

(async function init() {
  const ok = await checkLogin();
  if (ok) { showApp(); if (!location.hash) location.hash = '#/dashboard'; route(); }
  else { showLogin(); }
})();
