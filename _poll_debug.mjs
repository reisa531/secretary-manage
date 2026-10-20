import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'https://manage.dzhes.app';
const PROXY = 'http://127.0.0.1:7890';
const cj = path.join(os.tmpdir(), 'poll-cj.txt');
const curl = (a) => execFileSync('curl.exe', ['-sS', '--max-time', '60', '-x', PROXY, ...a], { encoding: 'utf8' });

curl(['-c', cj, '-H', 'Content-Type: application/json', '-d', '{"email":"jiangdzh2026@shanghaitech.edu.cn","password":"admin123"}', `${BASE}/api/auth/login`]);
const list = JSON.parse(curl(['-b', cj, `${BASE}/api/polls`])).polls;
const detail = [];
for (const p of list) {
  const d = JSON.parse(curl(['-b', cj, `${BASE}/api/polls/${p.id}`]));
  detail.push({ id: p.id, title: p.title, status: p.status, poll_type: p.poll_type, option_count: d.poll?.options?.length, options: d.poll?.options?.map((o) => o.text) });
}
writeFileSync('_polls_debug.json', JSON.stringify({ count: list.length, detail }, null, 2), 'utf8');
console.log('polls=' + list.length);
rmSync(cj, { force: true });
