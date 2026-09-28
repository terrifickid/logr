# logr

Trajectory logging for Node. One run of a wrapped function is one piece of
work: it gets a master id, records its steps, and records how it ended.

## Install

    npm install git+https://github.com/<user>/logr.git

Brings `arktype` and `pino` with it.

## Use

```js
import { logr } from 'logr';

export const fetchWithFallback = logr.trajectory(
  'fetchWithFallback',
  { spec: 'features/fetch-with-fallback.feature' },
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

`logr.trajectory(name, { spec }, fn)` wraps a function. `name` is the work's
name; `spec` names the file stating what the function is for; `fn` receives
the original arguments plus `log`.

`log.run(step, input, fn)` is one step of the work: `step` is its name,
`input` is what it is given, `fn` is the work it does. Call it once per step
and put the sublogic inside it.

## What each record carries

- `id` — the run. Created once per invocation, on every record.
- `subId` — one `log.run` call. Created once per call, on every record of
  that step.
- `event` — `start` on entry, then exactly one of `success` or `failure`.
- `durationMs` — on every ending record.
- `input` and `result` — on success; `input` and `error` on failure.
- `cause` — on the run's failure record, pointing at the step that caused it.

Records are pino JSON lines.

## Teach the coding agent

`AGENTS.md` ships with this module and carries the rules plus the module
source. Point OpenCode at the installed copy so the instructions can never
drift from the code:

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["node_modules/logr/AGENTS.md"],
}
```

## Layout

    logr.js        the module
    AGENTS.md      instructions for the coding agent, module source inline
