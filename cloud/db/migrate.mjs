import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool } from 'pg';
import { SCHEMA_SQL } from '../lib/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// 加载 .env.local（供 node 直接运行时使用；next 运行时会自动加载）
function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('缺少 DATABASE_URL 环境变量');
  process.exit(1);
}

const needsSsl = /(neon\.tech|rds\.amazonaws\.com|azure\.com|render\.com|supabase\.co)/i.test(url);
const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined });

const sql = SCHEMA_SQL;
await pool.query(sql);
console.log('✅ PostgreSQL schema 已应用（幂等）');
await pool.end();
