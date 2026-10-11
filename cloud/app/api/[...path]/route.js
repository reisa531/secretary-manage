import { handleRequest } from '../../../lib/api.js';

export const dynamic = 'force-dynamic';

async function handler(req, context) {
  const params = await context.params;
  const path = (params.path || []).join('/');
  try {
    return await handleRequest(req, path, req.method);
  } catch (e) {
    return Response.json({ error: e.message || '服务器错误' }, { status: 500 });
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
