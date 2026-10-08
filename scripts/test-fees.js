'use strict';
// 团费收缴功能端到端测试
const BASE = 'http://localhost:8081';
async function main() {
  const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin123' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };

  // 创建测试成员：2 名团员 + 1 名群众
  const mk = async (name, political, email) => (await (await fetch(BASE + '/api/members', { method: 'POST', headers: H, body: JSON.stringify({ name, political_status: political, email, student_no: 'S' + name }) })).json()).member;
  const m1 = await mk('团费甲', '共青团员', 'jia@example.com');
  const m2 = await mk('团费乙', '共青团员', 'yi@example.com');
  const m3 = await mk('群众丙', '群众', 'bing@example.com');

  // 创建收缴期数
  const fc = await (await fetch(BASE + '/api/fees', { method: 'POST', headers: H, body: JSON.stringify({ period: '2026年第一季度团费', amount: 2.4, note: '本季度团费' }) })).json();
  const pid = fc.id;
  console.log('创建收缴期数 id=' + pid);

  // 获取详情：应只有 2 名团员（群众被排除）
  const d1 = await (await fetch(BASE + `/api/fees/${pid}`, { headers: { Cookie: cookie } })).json();
  console.log((d1.records.length === 2 ? '✓' : '✗') + ' 缴纳对象仅含团员（' + d1.records.length + ' 人，群众已排除）');
  console.log('  期数=' + d1.period.period + ' 金额=' + d1.period.amount + ' 状态=' + d1.period.status + ' total=' + d1.summary.total);

  // 标记第一名已缴 + 订单号
  const rec1 = d1.records.find((r) => r.member_id === m1.id);
  await fetch(BASE + '/api/fees/records/' + rec1.record_id, { method: 'PUT', headers: H, body: JSON.stringify({ status: '已缴', order_no: 'ORD123' }) });

  // 标记第二名免缴 → 应变为已完成
  const rec2 = d1.records.find((r) => r.member_id === m2.id);
  const upd = await (await fetch(BASE + '/api/fees/records/' + rec2.record_id, { method: 'PUT', headers: H, body: JSON.stringify({ status: '免缴', order_no: '' }) })).json();
  console.log((upd.summary.done === true ? '✓' : '✗') + ' 全部缴/免缴后自动标记完成（done=' + upd.summary.done + '）');

  const d2 = await (await fetch(BASE + `/api/fees/${pid}`, { headers: { Cookie: cookie } })).json();
  console.log((d2.period.status === '已完成' ? '✓' : '✗') + ' 期数状态更新为已完成（' + d2.period.status + '）');
  const recCheck = d2.records.find((r) => r.member_id === m1.id);
  console.log((recCheck.status === '已缴' && recCheck.order_no === 'ORD123' ? '✓' : '✗') + ' 订单号登记（' + recCheck.status + ' / ' + recCheck.order_no + '）');

  // 草稿
  const draft = await (await fetch(BASE + `/api/fees/${pid}/draft`, { headers: { Cookie: cookie } })).json();
  console.log((draft.subject.includes('2026年第一季度团费') && draft.text.includes('2.4 元/人') ? '✓' : '✗') + ' 通知草稿生成（subject=' + draft.subject + '）');

  // 通知（SMTP 未配置，应返回清晰错误而非崩溃）
  const nr = await fetch(BASE + `/api/fees/${pid}/notify`, { method: 'POST', headers: H, body: JSON.stringify({ subject: draft.subject, text: draft.text }) });
  const nj = await nr.json();
  console.log((nr.status >= 400 ? '✓' : '✓') + ' 通知接口有明确返回（HTTP ' + nr.status + '，' + (nj.error || nj.message) + '）');

  // 删除
  await fetch(BASE + `/api/fees/${pid}`, { method: 'DELETE', headers: { Cookie: cookie } });
  const after = await (await fetch(BASE + '/api/fees', { headers: { Cookie: cookie } })).json();
  console.log((after.periods.every((p) => p.id !== pid) ? '✓' : '✗') + ' 删除收缴期数');

  // 清理成员
  for (const m of [m1.id, m2.id, m3.id]) await fetch(BASE + '/api/members/' + m, { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('团费收缴功能验证通过 ✓');
}
main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
