# logr — logging instructions for this project

Every loggable piece of work in this project uses logr. Nothing else writes
records: no `console.*`, no second pino instance, no direct file writes.

`import { logr } from 'logr';`

## The two calls

A **trajectory** wraps a function. One run of that function is one piece of
work: it gets a master id, writes a start record, runs its steps, and writes
a finish record when it returns or throws.

```js
export const fetchWithFallback = logr.trajectory(
  'fetchWithFallback',
  async (raw, log) => {
    const input = logr.type({
      url: "string.url",
      retries: "number.integer >= 0 = 1",
      mode: "'primary' | 'fallback'",
    }).assert(raw);

    const result = await log.run('fetch', input, () => doFetch(input));
    const enriched = await log.run('enrich', result, () => enrich(result));

    return logr.type({
      data: "unknown",
      source: "'primary' | 'fallback'",
    }).assert(enriched);
  }
);
```

- `logr.trajectory(name, fn)` — `name` is the work's name; `fn` receives the
  original arguments plus `log`.
- `log.run(step, input, fn)` — one step of the work. `step` is its name,
  `input` is what it is given, `fn` is the work it does. Call it once per
  step; sublogic goes inside it, never beside it.

## What the machinery records, so call sites never have to

- `id` — the run, created once per invocation. On every record.
- `subId` — one `log.run` call, created once per call. On every record of
  that step.
- `event` — `start` on entry, then exactly one of `success` or `failure`.
- `durationMs` — on every ending record.
- `input` and `result` — on success; `input` and `error` on failure.
- `cause` — on the run's failure record, pointing at the step that caused it.

## Rules

- Validate input when a trajectory starts and the result before it returns,
  with `logr.type(...).assert(...)`. A violation throws and lands in the
  failure record; nothing downstream proceeds on unchecked data.
- Never write a record outside a trajectory or a step.
- Never catch an error and continue as if nothing happened. `log.run` records
  the failure and rethrows; let it.
- Never put a secret value in a record.

## The module

```js
// logr.js
//
// A trajectory wraps a function. One run of that function is one piece of
// work: it gets a master id, writes a start record, runs its sublogic, and
// writes a finish record when it returns or throws. The sublogic runs
// through log.run(step, input, fn) — each step writes its own start and
// finish records, and every record of the run carries the master id.
//
// Records go to pino, one JSON object per line. Nothing writes to console.

import { type } from 'arktype';
import pino from 'pino';

export const pinoLog = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { error: pino.stdSerializers.err },
});

export const logr = {
  type,

  trajectory(name, fn) {
    const wrapped = async (...args) => {
      const id = crypto.randomUUID();
      const bus = pinoLog.child({ id, name });

      const log = {
        async run(step, input, fn) {
          const subId = crypto.randomUUID();
          const start = Date.now();
          bus.info({ ts: Date.now(), subId, step, event: 'start' });
          try {
            const result = await fn();
            bus.info({ ts: Date.now(), subId, step, event: 'success', durationMs: Date.now() - start, input, result });
            return result;
          } catch (error) {
            bus.error({ ts: Date.now(), subId, step, event: 'failure', durationMs: Date.now() - start, input, error });
            error.cause = { subId, step };
            throw error;
          }
        },
      };

      const start = Date.now();
      bus.info({ ts: Date.now(), event: 'start', input: args });

      try {
        const result = await fn(...args, log);
        bus.info({ ts: Date.now(), event: 'success', durationMs: Date.now() - start, result });
        return result;
      } catch (error) {
        const cause = error.cause ?? undefined;
        bus.error({ ts: Date.now(), event: 'failure', durationMs: Date.now() - start, cause });
        throw error;
      }
    };

    return wrapped;
  },
};
```
