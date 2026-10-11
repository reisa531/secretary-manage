import { query } from '../../../lib/db.js';
import { ensureReady } from '../../../lib/ready.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureReady();
    const r = await query('SELECT 1 AS ok, current_database() AS db, now() AS ts');
    return Response.json({ ok: true, service: 'secretary-manage-cloud', database: r[0]?.db, time: r[0]?.ts });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
