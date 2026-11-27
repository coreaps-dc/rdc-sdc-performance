import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();

export function checkPreviewAccess(request, env) {
  if (env.RDC_DEPLOYMENT_MODE !== 'preview') return null;

  const password = env.PREVIEW_ACCESS_TOKEN;
  const authorization = request.headers.get('Authorization') ?? '';
  if (password) {
    const expected = 'Basic ' + btoa('preview:' + password);
    if (timingSafeEqual(digest(authorization), digest(expected))) return null;
  }

  return new Response('Preview requires authentication.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="RDC SDC Performance Preview", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}
