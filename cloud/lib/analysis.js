'use strict';
/**
 * 团支部数字画像分析引擎（纯规则，无 AI 也可独立工作）。
 * 输出多维度的统计结果，用于图表展示，并作为 AI 生成团支书工作建议的输入。
 */

function parseTags(text) {
  return String(text || '')
    .split(/[,，、;；/\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function countMap(items) {
  const map = new Map();
  for (const it of items) {
    const k = String(it || '').trim() || '未填写';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function birthYear(birthDate) {
  const m = String(birthDate || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

function computeAgeStats(members) {
  const nowYear = new Date().getFullYear();
  const buckets = { '20岁以下': 0, '20-24岁': 0, '25-29岁': 0, '30岁及以上': 0, '未知': 0 };
  for (const m of members) {
    const y = birthYear(m.birth_date);
    if (y == null) { buckets['未知']++; continue; }
    const age = nowYear - y;
    if (age < 20) buckets['20岁以下']++;
    else if (age < 25) buckets['20-24岁']++;
    else if (age < 30) buckets['25-29岁']++;
    else buckets['30岁及以上']++;
  }
  return Object.entries(buckets).map(([name, value]) => ({ name, value }));
}

function computeTopTags(members, field, limit = 10) {
  const counter = new Map();
  for (const m of members) {
    for (const tag of parseTags(m[field])) {
      counter.set(tag, (counter.get(tag) || 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** 主入口：计算团支部完整数字画像。 */
function computeBranchStats(members, activities = []) {
  const total = members.length;
  const active = members.filter((m) => m.status === '在册').length;

  // 志愿服务意愿（0未标注/1愿意/2视情况/3暂不）
  const volMap = { 0: '未标注', 1: '愿意参与', 2: '视情况参与', 3: '暂不参与' };
  const volunteerWilling = countMap(members.map((m) => volMap[Number(m.volunteer_willing) || 0]));

  // 志愿类型关键词（"哪些人愿意作为志愿者参与组织活动" → 分布）
  const willingMembers = members.filter((m) => Number(m.volunteer_willing) === 1);
  const volunteerTypeTags = computeTopTags(willingMembers, 'volunteer_types', 10);

  const stats = {
    total,
    active,
    gender: countMap(members.map((m) => m.gender)),
    age: computeAgeStats(members),
    political_status: countMap(members.map((m) => m.political_status)),
    education: countMap(members.map((m) => m.education)),
    league_role: countMap(members.map((m) => m.league_role)),
    fee_status: countMap(members.map((m) => m.fee_status)),
    hobbies: computeTopTags(members, 'hobbies', 15),
    specialties: computeTopTags(members, 'specialties', 15),
    skills: computeTopTags(members, 'skills', 15),
    volunteer_willing: volunteerWilling,
    volunteer_type_tags: volunteerTypeTags,
    willing_count: willingMembers.length,
    willing_names: willingMembers.slice(0, 30).map((m) => m.name),
    activity_count: activities.length,
    activity_types: countMap(activities.map((a) => a.type)),
    avg_age: computeAvgAge(members),
  };

  // 供 AI 使用的精简摘要（避免过大）
  stats.summary_text = buildSummaryText(stats);
  return stats;
}

function computeAvgAge(members) {
  const nowYear = new Date().getFullYear();
  const ages = members.map((m) => birthYear(m.birth_date)).filter((y) => y != null).map((y) => nowYear - y);
  if (!ages.length) return null;
  return Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10;
}

function buildSummaryText(stats) {
  const g = stats.gender.map((x) => `${x.name}${x.value}人`).join('、');
  const topHobbies = stats.hobbies.slice(0, 5).map((x) => `${x.name}(${x.value}人)`).join('、');
  const topSpec = stats.specialties.slice(0, 5).map((x) => `${x.name}(${x.value}人)`).join('、');
  const vol = stats.volunteer_willing.map((x) => `${x.name}${x.value}人`).join('、');
  return [
    `共${stats.total}名团员（在册${stats.active}人），平均年龄${stats.avg_age ?? '未知'}岁。`,
    `性别分布：${g || '未填写'}。`,
    `热门爱好：${topHobbies || '暂无'}。`,
    `优势特长：${topSpec || '暂无'}。`,
    `志愿服务意愿：${vol}，其中明确愿意参与的有${stats.willing_count}人。`,
    `已登记活动${stats.activity_count}个。`,
  ].join('\n');
}

export { computeBranchStats, computeTopTags, countMap, parseTags };
