// probe.mjs — exercise logr.js: a happy run, a thrown failure, a shape violation.
import { logr } from '../logr.js';

const doFetch = async (input) => {
  if (input.url.includes('primary-fails')) {
    const err = new Error('primary source refused the request');
    err.status = 503;
    throw err;
  }
  return { data: { id: 'x1' }, source: 'primary' };
};

const fetchWithFallback = logr.trajectory(
  'fetchWithFallback',
  { spec: 'features/fetch-with-fallback.feature' },
  async (raw, log) => {
    const input = logr.type({
      url: 'string.url',
      retries: 'number.integer >= 0 = 1',
      mode: "'primary' | 'fallback'",
    }).assert(raw);

    const result = await log.run('fetch', input, () => doFetch(input));
    const enriched = await log.run('enrich', result, () => enrich(result));

    const shaped = logr.type({
      data: 'unknown',
      source: "'primary' | 'fallback'",
    }).assert(enriched);

    log.check('fetchWithFallback result', { source: 'string' }, shaped);
    return shaped;
  },
);

async function enrich(r) {
  return { data: r.data, source: r.source };
}

console.log('--- happy run ---');
const ok = await fetchWithFallback({ url: 'https://example.com/a', retries: 1, mode: 'primary' });
console.log('returned:', JSON.stringify(ok));

console.log('--- thrown failure ---');
try {
  await fetchWithFallback({ url: 'https://primary-fails.example.com/a', retries: 0, mode: 'primary' });
} catch (e) {
  console.log('rethrown:', e.message, 'status', e.status);
}

console.log('--- bad input (arktype) ---');
try {
  await fetchWithFallback({ url: 'not-a-url', retries: -1, mode: 'nope' });
} catch (e) {
  console.log('rethrown:', e.constructor.name, String(e.message).slice(0, 80));
}
