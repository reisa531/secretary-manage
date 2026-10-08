'use strict';
// 验证 AI 客户端（OpenAI 兼容）请求格式与 JSON 解析、画像生成
const http = require('node:http');
const ai = require('../lib/ai');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body);
    // 校验请求格式
    const okUrl = req.url === '/chat/completions';
    const okAuth = req.headers.authorization === 'Bearer test-key';
    const okModel = parsed.model === 'test-model';
    const hasMessages = Array.isArray(parsed.messages);
    const userMsg = (parsed.messages || []).find((m) => m.role === 'user');
    console.log((okUrl ? '✓' : '✗') + ' 请求路径 /chat/completions');
    console.log((okAuth ? '✓' : '✗') + ' Authorization Bearer');
    console.log((okModel ? '✓' : '✗') + ' 模型字段');
    console.log((hasMessages ? '✓' : '✗') + ' messages 数组');
    console.log((userMsg ? '✓' : '✗') + ' 自我介绍已传入 (' + (userMsg ? userMsg.content.length : 0) + ' 字)');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        personality: ['开朗', '负责'],
        interests: ['篮球', '读书'],
        strengths: ['组织能力强'],
        volunteer_style: '乐于参加志愿服务',
        role_suggestion: '适合担任组织委员',
        summary: '一名开朗负责的团员。',
        tags: ['积极分子', '组织者'],
      }) } }],
    }));
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const settings = { ai_provider: 'openai', ai_base_url: 'http://127.0.0.1:' + port, ai_api_key: 'test-key', ai_model: 'test-model', ai_temperature: 0.7 };
  const member = { name: '张三', self_intro: '性格开朗，乐于助人', hobbies: '篮球,读书', specialties: '组织', volunteer_willing: 1, volunteer_types: '社区服务' };
  const portrait = await ai.generateMemberPortrait(member, settings);
  console.log('画像生成:', portrait.summary, '| 性格:', portrait.personality.join('、'), '| 标签:', portrait.tags.join('、'));
  console.log(portrait.summary ? 'AI 画像生成流程验证通过 ✓' : '画像生成失败 ✗');
  server.close();
});
