'use client';

import { useEffect, useState, use } from 'react';

const STATUS_LABEL = { open: '进行中', closed: '已结束', upcoming: '未开始', draft: '草稿' };
const STATUS_CLASS = { open: 'open', closed: 'closed', upcoming: 'upcoming', draft: 'draft' };

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PollPage({ params }) {
  const { id } = use(params);
  const [poll, setPoll] = useState(null);
  const [me, setMe] = useState(null);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [studentNo, setStudentNo] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setErr('');
    const [p, m] = await Promise.all([
      fetch(`/api/polls/${id}`).then((r) => r.json()),
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
    ]);
    setPoll(p);
    setMe(m);
    if (m && m.type === 'member' && p.my_option_ids) setSelected(p.my_option_ids);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, [id]);

  async function doLogin(e) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const r = await fetch('/api/auth/member-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, student_no: studentNo }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || '登录失败'); return; }
      await refresh();
    } finally { setSubmitting(false); }
  }

  function toggle(optId) {
    if (!poll || poll.poll.effective_status !== 'open') return;
    if (poll.poll.poll_type === 'single') setSelected([optId]);
    else {
      setSelected((prev) => prev.includes(optId) ? prev.filter((x) => x !== optId) : [...prev, optId]);
    }
  }

  async function doVote() {
    setErr('');
    if (!selected.length) { setErr('请先选择选项'); return; }
    setSubmitting(true);
    try {
      const r = await fetch(`/api/polls/${id}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_ids: selected }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || '投票失败'); return; }
      await refresh();
    } finally { setSubmitting(false); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMe(null);
    setSelected([]);
  }

  if (loading) return <main className="container"><div className="empty">加载中…</div></main>;
  if (!poll || !poll.poll) return <main className="container"><div className="empty">投票不存在</div></main>;

  const p = poll.poll;
  const st = p.effective_status;
  const denied = poll.denied_reason || (poll.in_scope === false ? '对不起，你没有权限参与本次投票' : '');
  const counts = poll.counts || {};
  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0) || 0;
  const showResults = !!poll.counts;

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ margin: '0 0 8px' }}>{p.title} <span className={`badge ${STATUS_CLASS[st]}`}>{STATUS_LABEL[st]}</span></h1>
        {!denied && p.description ? <div className="hint desc-box" style={{ marginBottom: 8 }}>{p.description}</div> : null}
        {!denied && (
          <div className="meta">
            {p.poll_type === 'single' ? '单选' : `多选（最多 ${p.multi_max} 项）`}
            {p.is_anonymous ? ' · 匿名' : ' · 实名'}
            <span style={{ marginLeft: 8 }}>开始 {fmt(p.start_at)} · 结束 {fmt(p.end_at)}</span>
            {typeof poll.participants === 'number' ? <span style={{ marginLeft: 8 }}>已参与 {poll.participants} 人</span> : null}
          </div>
        )}
      </div>

      {/* 登录态 */}
      {!me ? (
        <div className="card">
          <h2>请先认证身份参与投票</h2>
          <p className="hint">输入你的姓名与学号完成认证</p>
          <form onSubmit={doLogin}>
            <div className="field"><label>姓名</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" /></div>
            <div className="field"><label>学号</label><input type="text" value={studentNo} onChange={(e) => setStudentNo(e.target.value)} placeholder="学号" /></div>
            <button className="btn" type="submit" disabled={submitting}>认证并进入</button>
            <div className="err">{err}</div>
          </form>
        </div>
      ) : me.type === 'member' ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>已认证：<strong>{me.member.name}</strong>（{me.member.student_no}）</span>
            <button className="btn ghost" onClick={logout}>退出</button>
          </div>
        </div>
      ) : (
        <div className="card"><span>当前为管理端登录态</span></div>
      )}

      {/* 不在参与范围：只显示拒绝提示，不渲染选项 */}
      {denied && me?.type === 'member' ? (
        <div className="card">
          <h2>无法参与</h2>
          <p className="err" style={{ fontSize: 15 }}>{denied}</p>
          <p className="hint">本次投票已设置参与范围，你的身份或账号不在此范围内。如需参与，请联系团支书确认。</p>
        </div>
      ) : null}

      {/* 选项 */}
      {!denied && p.options && p.options.length > 0 && (
        <div className="card">
          <h2>选项</h2>
          {p.options.map((o) => {
            const checked = selected.includes(o.id);
            const cnt = counts[o.id] || 0;
            const pct = totalVotes ? Math.round((cnt / totalVotes) * 100) : 0;
            const canVote = me?.type === 'member' && poll.in_scope !== false && st === 'open' && !poll.has_voted;
            return (
              <div key={o.id}>
                <div className="option-row" onClick={() => toggle(o.id)} style={!canVote ? { cursor: 'default' } : {}}>
                  <input type={p.poll_type === 'single' ? 'radio' : 'checkbox'} checked={checked} readOnly disabled={!canVote} />
                  <span>{o.text}</span>
                  {showResults ? <span className="hint" style={{ marginLeft: 'auto' }}>{cnt} 票（{pct}%）</span> : null}
                </div>
                {showResults ? <div style={{ background: '#eef2f7', borderRadius: 6, height: 8, margin: '-4px 0 10px 28px' }}><div className="result-bar" style={{ width: pct + '%', height: 8 }} /></div> : null}
              </div>
            );
          })}
          {st === 'open' && me?.type === 'member' && poll.in_scope !== false && !poll.has_voted && (
            <>
              <button className="btn" onClick={doVote} disabled={submitting}>提交投票</button>
              <div className="err">{err}</div>
            </>
          )}
          {poll.has_voted && <p className="hint">你已参与本次投票{p.allow_change_vote ? '，可修改后重新提交' : ''}</p>}
        </div>
      )}

      <p><a href="/">← 返回首页</a></p>
    </main>
  );
}
