// emit.mjs — one run, records to stdout.
import { logr } from '../logr.js';

const fn = logr.trajectory('probe', async (raw, log) => {
  const good = await log.run('good', raw, async () => ({ ok: true }));
  log.check('good result', { ok: 'boolean' }, good);
  log.check('bad result', { ok: 'string' }, good); // deliberate violation
  try {
    await log.run('bad', raw, async () => {
      const e = new Error('boom');
      e.code = 'E_BOOM';
      throw e;
    });
  } catch {
    /* handled here, not rethrown */
  }
  return good;
});

await fn({ a: 1 });
await new Promise((r) => setTimeout(r, 60));
