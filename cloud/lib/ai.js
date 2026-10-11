'use strict';
/**
 * AI 客户端（零外部依赖，使用 Node 内置 fetch）。
 * 支持两类接口：
 *   - OpenAI 兼容（OpenAI / DeepSeek / 通义 / 智谱 / SiliconFlow / Ollama 的 /v1 等）
 *   - Ollama 原生 /api/chat
 * 用于：团员个人画像总结、团支部数字画像分析与团支书工作建议。
 */

function getAIConfig(settings) {
  return {
    provider: settings.ai_provider || 'openai',
    baseUrl: (settings.ai_base_url || '').replace(/\/+$/, ''),
    apiKey: settings.ai_api_key || '',
    model: settings.ai_model || 'deepseek-chat',
    temperature: Number(settings.ai_temperature ?? 0.7),
  };
}

/** 调用一次对话补全，返回文本内容。 */
async function chatCompletion(cfg, messages, opts = {}) {
  if (!cfg.baseUrl) throw new Error('未配置 AI 接口地址（ai_base_url）');
  if (!cfg.model) throw new Error('未配置 AI 模型（ai_model）');

  if (cfg.provider === 'ollama') {
    const url = cfg.baseUrl + '/api/chat';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        options: { temperature: cfg.temperature },
        messages,
      }),
    });
    if (!resp.ok) throw new Error(`Ollama 调用失败 HTTP ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    return data?.message?.content || '';
  }

  // OpenAI 兼容
  const url = cfg.baseUrl + '/chat/completions';
  const body = { model: cfg.model, temperature: cfg.temperature, messages };
  if (opts.json) body.response_format = { type: 'json_object' };
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`AI 调用失败 HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

/** 从 AI 返回文本中稳健地提取 JSON 对象。 */
function parseJson(text) {
  if (!text) return null;
  const s = String(text).trim();
  // 去掉可能的 markdown 代码围栏
  let cleaned = s;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* 继续尝试提取首个 {} */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch { /* 放弃 */ }
  }
  return null;
}

function buildMemberPrompt(member) {
  const parts = [];
  if (member.self_intro) parts.push('自我介绍：' + member.self_intro);
  if (member.admin_notes) parts.push('管理员补充观察：' + member.admin_notes);
  if (member.hobbies) parts.push('兴趣爱好：' + member.hobbies);
  if (member.specialties) parts.push('特长：' + member.specialties);
  if (member.skills) parts.push('技能：' + member.skills);
  if (member.major) parts.push('专业/岗位：' + member.major);
  const volunteer = ['未标注', '愿意', '视情况', '暂不'][Number(member.volunteer_willing) || 0];
  parts.push('志愿服务意愿：' + volunteer);
  if (member.volunteer_types) parts.push('可参与志愿类型：' + member.volunteer_types);
  if (member.league_role) parts.push('团内职务：' + member.league_role);
  if (member.political_status) parts.push('政治面貌：' + member.political_status);
  return parts.join('\n');
}

/** 生成单个团员的画像（返回结构化 JSON）。AI 不可用时自动降级为规则画像，不抛错。 */
async function generateMemberPortrait(member, settings) {
  const cfg = getAIConfig(settings);
  const info = buildMemberPrompt(member);
  const system =
    '你是团支部书记的智能助手，擅长做团员画像分析。请基于给定信息，用中文输出一个 JSON 对象（不要输出 JSON 以外的任何文字），结构如下：' +
    '{"personality":["性格特征关键词"],"interests":["兴趣偏好"],"strengths":["优势特长"],' +
    '"volunteer_style":"志愿服务倾向的一段话","role_suggestion":"适合在团支部中承担的角色的建议",' +
    '"summary":"80字以内的总体画像总结","tags":["3-6个画像标签"]}' +
    '分析要客观、克制，只依据提供的信息，信息不足时宁可不猜测。';
  try {
    const content = await chatCompletion(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: info || '（该团员暂无自我介绍与补充信息）' },
    ], { json: true });
    const json = parseJson(content);
    if (!json) {
      const fb = fallbackPortrait(member);
      fb.fallback_reason = 'AI 未返回有效 JSON，已使用规则画像';
      return fb;
    }
    return {
      personality: json.personality || [],
      interests: json.interests || [],
      strengths: json.strengths || [],
      volunteer_style: json.volunteer_style || '',
      role_suggestion: json.role_suggestion || '',
      summary: json.summary || '',
      tags: json.tags || [],
      raw: content,
    };
  } catch (e) {
    const fb = fallbackPortrait(member);
    fb.fallback_reason = 'AI 调用失败（' + e.message + '），已使用规则画像。请检查「系统设置」中的 AI 配置。';
    return fb;
  }
}

/** 无 AI 或 AI 失败时的规则兜底画像。 */
function fallbackPortrait(member) {
  const hobbies = (member.hobbies || '').split(/[,，、;；\s]+/).filter(Boolean);
  const specialties = (member.specialties || '').split(/[,，、;；\s]+/).filter(Boolean);
  const volunteer = Number(member.volunteer_willing) || 0;
  const volunteerStyle = ['志愿意愿未标注', '愿意作为志愿者参与组织活动', '视情况参与志愿服务', '暂不方便参与志愿服务'][volunteer];
  const tags = [...hobbies.slice(0, 3), ...specialties.slice(0, 2), volunteer === 1 ? '志愿服务积极分子' : ''].filter(Boolean);
  return {
    personality: [],
    interests: hobbies,
    strengths: specialties,
    volunteer_style: volunteerStyle,
    role_suggestion: '',
    summary: `${member.name}${specialties.length ? '，擅长' + specialties.slice(0, 3).join('、') : ''}${hobbies.length ? '，兴趣' + hobbies.slice(0, 3).join('、') : ''}。${volunteerStyle}。`,
    tags,
    raw: '',
    fallback: true,
  };
}

/** 生成团支部数字画像分析与团支书工作建议。 */
async function generateBranchGuidance(stats, settings) {
  const cfg = getAIConfig(settings);
  const system =
    '你是团支部建设的资深顾问。请基于提供的团支部数字画像统计数据，用中文输出一个 JSON 对象（不要输出 JSON 以外的任何文字），结构如下：' +
    '{"overview":"团支部整体画像的总体评价(120字内)",' +
    '"highlights":["2-4个突出特点/优势"],' +
    '"suggestions":[{"title":"建议标题","detail":"具体可操作建议(40字内)"}],' +
    '"risk_points":["需要注意或改进的方面"]}' +
    '建议要具体、可执行，贴合团支书实际工作（组织生活、志愿服务、思想引领、团建活动等）。';
  const content = await chatCompletion(cfg, [
    { role: 'system', content: system },
    { role: 'user', content: '团支部数字画像统计如下（JSON）：\n' + JSON.stringify(stats, null, 2) },
  ], { json: true });
  const json = parseJson(content);
  if (!json) {
    return {
      overview: '（AI 分析未返回有效结果，请检查 AI 配置后重试。）',
      highlights: [],
      suggestions: [],
      risk_points: [],
      raw: content,
    };
  }
  return { ...json, raw: content };
}

export { getAIConfig, chatCompletion, parseJson, generateMemberPortrait, generateBranchGuidance, fallbackPortrait };
