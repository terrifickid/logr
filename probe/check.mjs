// check.mjs — read the records logr.js produces and assert the invariants.
// Capture: pipe the process's stdout through a tap, so we read exactly what
// the logger writes.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, [new URL('./emit.mjs', import.meta.url).pathname], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
let buf = '';
child.stdout.on('data', (d) => (buf += d));
await new Promise((r) => child.on('close', r));

const lines = buf.split('\n').filter((l) => l.trim().startsWith('{'));
const parsed = lines.map((l) => JSON.parse(l));
const fails = [];
const ok = (t, c) => { if (!c) fails.push(t); };

ok('records exist', parsed.length > 0);
ok('every record has traceId/spanId/seq',
  parsed.every((r) => /^[0-9a-f]{32}$/.test(r.traceId) && /^[0-9a-f]{16}$/.test(r.spanId) && Number.isInteger(r.seq)));
ok('exactly one traceId', new Set(parsed.map((r) => r.traceId)).size === 1);
ok('seq is 1..n in order', parsed.map((r) => r.seq).every((s, i) => s === i + 1));

const bySpan = {};
for (const r of parsed) (bySpan[r.spanId] ??= []).push(r.event);
for (const [span, evs] of Object.entries(bySpan)) {
  const started = evs.filter((e) => e.endsWith('.started')).length;
  const ended = evs.filter((e) => e.endsWith('.succeeded') || e.endsWith('.failed')).length;
  ok(`span ${span.slice(0, 6)}: starts(${started}) == endings(${ended})`, started === ended);
}

ok('every ending has outcome+durationMs',
  parsed.filter((r) => /\.(succeeded|failed)$/.test(r.event)).filter((r) => r.step || r.event === parsed[0].event.replace('started','succeeded') || true).every((r) => r.outcome && typeof r.durationMs === 'number'));
ok('start records carry neither outcome nor durationMs',
  parsed.filter((r) => /\.started$/.test(r.event)).every((r) => r.outcome === undefined && r.durationMs === undefined));
ok('violated checks carry no outcome (flow, not ending)',
  parsed.filter((r) => /\.check\./.test(r.event)).every((r) => r.outcome === undefined));
ok('failures carry class/consequence/error fields',
  parsed.filter((r) => r.outcome === 'failure' && r.step).every((r) => r.failure?.class && r.failure?.consequence && r.failure?.error?.name));
ok('failure error is flat fields, not a raw object',
  parsed.filter((r) => r.failure).every((r) => typeof r.failure.error.stack === 'string' || typeof r.failure.error.name === 'string'));

const viol = parsed.find((r) => r.event.endsWith('check.violated'));
ok('violated check is an error record with expected/actual/where',
  !!viol && viol.severity === 'ERROR' && !!viol.expected && !!viol.actual && !!viol.where);
ok('no duplicate top-level keys in any line', lines.every((l) => {
  let depth = 0, instr = false, esc = false; const keys = [];
  for (let i = 0; i < l.length; i += 1) {
    const c = l[i];
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') {
      instr = !instr;
      if (instr && depth === 1) { const j = l.indexOf('"', i + 1); if (l[j + 1] === ':') keys.push(l.slice(i + 1, j)); }
    } else if (!instr) { if (c === '{') depth += 1; else if (c === '}') depth -= 1; }
  }
  return new Set(keys).size === keys.length;
}));
ok('no secret-shaped fields', !lines.some((l) => /"(password|authorization|cookie|secret|token)":/i.test(l)));
ok('work ended with an outcome', /\.(succeeded|failed)"$/.test(`"${parsed.at(-1).event}"`));

console.log('records:', parsed.length);
console.log('events:\n  ' + parsed.map((r) => `${r.seq} ${r.event} [${r.outcome ?? '-'}]`).join('\n  '));
console.log(fails.length === 0 ? '\nALL INVARIANTS PASS' : `\nFAILURES:\n- ${fails.join('\n- ')}`);
process.exit(fails.length === 0 ? 0 : 1);
