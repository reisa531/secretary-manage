import { Pool } from 'pg';

// 全局单例连接池：避免 Next.js 开发模式热重载创建过多连接
const globalForDb = globalThis;

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('缺少 DATABASE_URL 环境变量');
  const needsSsl = /(neon\.tech|rds\.amazonaws\.com|azure\.com|render\.com|supabase\.co)/i.test(url);
  return new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

export const pool = globalForDb.__secretaryPool || (globalForDb.__secretaryPool = createPool());

/** 执行查询，返回行数组 */
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** 执行查询，返回第一行或 null */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/** 执行事务 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
