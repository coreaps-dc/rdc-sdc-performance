import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPreviewAccess } from '../lib/preview-access.mjs';

test('Preview rejects missing credentials, wrong passwords, and missing secret', () => {
  const env = { RDC_DEPLOYMENT_MODE: 'preview', PREVIEW_ACCESS_TOKEN: 'test-token' };
  const url = 'https://example.test/api/health';
  const wrong = new Request(url, { headers: { Authorization: 'Basic ' + btoa('preview:wrong') } });
  assert.equal(checkPreviewAccess(new Request(url), env)?.status, 401);
  assert.equal(checkPreviewAccess(wrong, env)?.status, 401);
  assert.equal(checkPreviewAccess(new Request(url), { RDC_DEPLOYMENT_MODE: 'preview' })?.status, 401);
});

test('Preview accepts the correct credentials and Production skips the Preview gate', () => {
  const request = new Request('https://example.test/', {
    headers: { Authorization: 'Basic ' + btoa('preview:test-token') },
  });
  assert.equal(checkPreviewAccess(request, { RDC_DEPLOYMENT_MODE: 'preview', PREVIEW_ACCESS_TOKEN: 'test-token' }), null);
  assert.equal(checkPreviewAccess(new Request('https://example.test/'), {}), null);
});
