import { query } from '../lib/db.js';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = { open: '进行中', closed: '已结束', upcoming: '未开始', draft: '草稿' };
const STATUS_CLASS = { open: 'open', closed: 'closed', upcoming: 'upcoming', draft: 'draft' };

function effectiveStatus(p) {
  if (p.status === 'draft') return 'draft';
  if (p.status === 'closed') return 'closed';
  const now = Date.now();
  if (p.end_at && new Date(p.end_at).getTime() < now) return 'closed';
  if (p.start_at && new Date(p.start_at).getTime() > now) return 'upcoming';
  return 'open';
}

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function Home() {
  const posts = await query(`SELECT * FROM posts WHERE status = 'published' ORDER BY is_pinned DESC, published_at DESC NULLS LAST, id DESC`);
  const polls = await query(`SELECT * FROM polls WHERE status != 'draft' ORDER BY published_at DESC NULLS LAST, id DESC`);

  return (
    <main className="container">
      <div className="section-title">📢 信息发布</div>
      {posts.length === 0 && <div className="empty">暂无公开信息</div>}
      {posts.map((p) => (
        <div className="card" key={p.id}>
          <h2><a href={`/posts/${p.id}`}>{p.title}</a></h2>
          <div className="meta">
            {p.is_pinned ? <span className="pin">置顶</span> : null}
            <span className="category">{p.category}</span>
            <span style={{ marginLeft: 8 }}>{fmt(p.published_at)}</span>
          </div>
        </div>
      ))}

      <div className="section-title">🗳️ 投票</div>
      {polls.length === 0 && <div className="empty">暂无投票</div>}
      {polls.map((p) => {
        const st = effectiveStatus(p);
        return (
          <div className="card" key={p.id}>
            <h2><a href={`/polls/${p.id}`}>{p.title}</a> <span className={`badge ${STATUS_CLASS[st]}`}>{STATUS_LABEL[st]}</span></h2>
            {p.description ? <div className="hint poll-preview" style={{ marginBottom: 6 }}>{p.description}</div> : null}
            <div className="meta">开始 {fmt(p.start_at)} · 结束 {fmt(p.end_at)}</div>
          </div>
        );
      })}
    </main>
  );
}
