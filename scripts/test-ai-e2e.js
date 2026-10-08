'use strict';
// 端到端验证：通过真实 HTTP 服务验证 AI 配置读取修复（用 mock OpenAI 兼容服务）
const http = require('node:http');

const BASE = 'http://localhost:8081';
let aiServer;
let aiPort;

function startMockAI() {
  return new Promise((resolve) => {
    aiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        const user = (parsed.messages || []).find((m) => m.role === 'user');
        const isPortrait = user && /自我介绍|性格/.test(user.content);
        const content = isPortrait
          ? JSON.stringify({ personality: ['开朗'], interests: ['篮球'], strengths: ['组织'], volunteer_style: '愿意参与', role_suggestion: '组织委员', summary: 'E2E画像成功', tags: ['积极分子'] })
          : JSON.stringify({ overview: 'E2E建议成功', highlights: ['团队活跃'], suggestions: [{ title: '多组织志愿活动', detail: '每月一次' }], risk_points: ['参与度不均'] });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    aiServer.listen(0, '127.0.0.1', () => { aiPort = aiServer.address().port; resolve(); });
  });
}

async function main() {
  await startMockAI();
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // 记录原始 AI 配置以便恢复
  const s0 = await (await fetch(BASE + '/api/settings', { headers: { Cookie: cookie } })).json();

  // 1. 配置指向 mock AI
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({
    ai_provider: 'openai', ai_base_url: 'http://127.0.0.1:' + aiPort, ai_model: 'test-model', ai_api_key: 'test-key', ai_temperature: '0.5',
  }) });

  // 2. 创建测试成员并生成画像（应返回 E2E 画像，而非规则兜底）
  const mk = await (await fetch(BASE + '/api/members', { method: 'POST', headers: H, body: JSON.stringify({ name: 'AI测试员', hobbies: '篮球', self_intro: '性格开朗' }) })).json();
  const pr = await (await fetch(BASE + `/api/members/${mk.member.id}/portrait`, { method: 'POST', headers: H })).json();
  const portraitOK = pr.portrait && pr.portrait.summary === 'E2E画像成功' && !pr.portrait.fallback_reason;
  console.log((portraitOK ? '✓' : '✗') + ' 团员画像经 HTTP 正确调用 AI（summary=' + (pr.portrait && pr.portrait.summary) + '）');

  // 3. 数字画像 AI 建议
  const g = await (await fetch(BASE + '/api/branch-guidance', { method: 'POST', headers: H })).json();
  const guideOK = g.guidance && g.guidance.overview === 'E2E建议成功';
  console.log((guideOK ? '✓' : '✗') + ' 团支书工作建议经 HTTP 正确调用 AI（overview=' + (g.guidance && g.guidance.overview) + '）');

  // 4. AI 测试接口
  const at = await fetch(BASE + '/api/ai/test', { method: 'POST', headers: H });
  const atj = await at.json();
  console.log((at.ok && atj.ok ? '✓' : '✗') + ' AI 测试接口 HTTP ' + at.status);

  // 恢复原始 AI 配置
  await fetch(BASE + '/api/settings', { method: 'PUT', headers: H, body: JSON.stringify({
    ai_provider: s0.ai_provider, ai_base_url: s0.ai_base_url, ai_model: s0.ai_model, ai_temperature: s0.ai_temperature,
    ai_api_key: s0.ai_api_key_set ? undefined : '__CLEAR__',
  }) });

  // 清理
  await fetch(BASE + '/api/members/' + mk.member.id, { method: 'DELETE', headers: { Cookie: cookie } });

  const allOK = portraitOK && guideOK && at.ok && atj.ok;
  console.log(allOK ? 'AI 配置读取修复端到端验证通过 ✓' : '存在问题 ✗');
  aiServer.close();
  if (!allOK) process.exitCode = 1;
}
main().catch((e) => { console.error('FAIL:', e.message); if (aiServer) aiServer.close(); process.exit(1); });
