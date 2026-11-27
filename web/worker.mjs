import app from './.open-next/worker.js';
import { checkPreviewAccess } from './lib/preview-access.mjs';

const worker = {
  fetch(request, env, ctx) {
    return checkPreviewAccess(request, env) ?? app.fetch(request, env, ctx);
  },
};

export default worker;
