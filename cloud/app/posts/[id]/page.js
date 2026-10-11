import { queryOne } from '../../../lib/db.js';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default async function PostPage({ params }) {
  const { id } = await params;
  const post = await queryOne(`SELECT * FROM posts WHERE id = $1 AND status = 'published'`, [id]);
  if (!post) notFound();

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ margin: '0 0 10px' }}>{post.title}</h1>
        <div className="meta">
          <span className="category">{post.category}</span>
          <span style={{ marginLeft: 8 }}>发布于 {fmt(post.published_at)}</span>
        </div>
        <div className="content-body" style={{ marginTop: 14 }}>{post.content || '（无正文）'}</div>
      </div>
      <p><a href="/">← 返回首页</a></p>
    </main>
  );
}
