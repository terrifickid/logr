import { logr } from '../logr.js';

const doFetch = async (i) => { if (i.url === 'boom') throw Object.assign(new Error('refused'), { status: 503 }); return { data: 1, source: i.mode }; };
const enrich = async (r) => r;

export const fetchWithFallback = logr.trajectory(
  'fetchWithFallback',
  { spec: 'features/fetch-with-fallback.feature' },
  async (raw, log) => {
    const input = logr.type({
      url: 'string',
      retries: 'number.integer >= 0 = 1',
      mode: "'primary' | 'fallback'",
    }).assert(raw);
    const result = await log.run('fetch', input, () => doFetch(input));
    const enriched = await log.run('enrich', result, () => enrich(result));
    return logr.type({ data: 'unknown', source: "'primary' | 'fallback'" }).assert(enriched);
  },
);

console.log('--- ok run ---');
console.log(JSON.stringify(await fetchWithFallback({ url: 'x', retries: 1, mode: 'primary' })));
console.log('--- failing run ---');
try { await fetchWithFallback({ url: 'boom', retries: 0, mode: 'fallback' }); }
catch (e) { console.log('rethrown:', e.message); }
