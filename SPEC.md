# logr — Logging & Verification Standard

Specification v0.1 — draft for review. 2026-09-25.

This document is the architectural blueprint for how all generated
Node/TypeScript code logs and verifies itself, and for the artifact that
enforces it: a generation guide (the rubric) loaded by the coding agent on
every task.

Relationship to `logging.md` (the original Pino ruleset in this folder):
`logging.md` stays as the human-readable foundation; this spec supersedes it
where they disagree, and the rubric derived from this spec is the version
the agent actually reads.

---

## 1. Purpose

All generated code must log and verify itself under one standard, so that:

- every run leaves a complete, readable, semantic record;
- every failure — including failures that never throw — is locatable from
  the logs alone;
- the logs of a run read as the history of an intent.

The acceptance test is the reader test:

> Hand a stranger the records of one intent. They can narrate it start to
> finish — what it wanted, what each step did, what data moved, what came
> back, how it ended, and why.

"What did this run do?" and "why did it fail?" must both be answerable from
the records alone. A record that cannot be understood without the source
code is a defect.

## 2. Meaning is derived, not assigned

The ontology, from which everything else follows:

    use -> purpose -> structure -> type -> record

- **Use** — what the system is for in the world: who runs it, to what end.
- **Purpose** — what each operation exists to do within that use.
- **Structure** — the parts of the work: steps, actors, artifacts, states.
- **Type** — the kinds of occurrences that can happen, derived from
  structure and purpose.
- **Record** — the log entries; each carries the meaning of its type.

Consequences:

- There is no fixed vocabulary and no catalog of event names. A fixed
  dictionary is types without derivation — labels someone invented, and
  invented labels don't carry meaning. The agent derives names and types in
  the context of the code it is writing, because it can see that code's
  purpose and structure.
- What is fixed: the naming grammar (how derived names are shaped), the
  shared keys (a small set of field names whose meaning must be identical
  everywhere), the significance rules, and the derivation procedure itself.
- Significance follows purpose. A defeated purpose is an error; an expected
  fork is not; a cancellation is not. Two identical events — an HTTP call
  returning 500 — are different kinds of occurrence in different uses: the
  payment authorization failing means the purpose is defeated; the analytics
  ping failing means almost nothing. The record's type and severity must say
  which.
- Meaning is context-dependent and the record must carry the context that
  fixes it: the same 404 means failure when the resource was expected and
  means nothing when existence was being probed. The record states its
  situation well enough that only one reading survives.

## 3. Architecture — two co-required halves

    logging        what happened, with the data that moved
    verification   whether each value is what it must be

Both ship together in everything generated — every function, module, entry
point, initializer. Neither is optional: a program that logs but does not
verify fails the standard, and vice versa.

Coverage is exhaustive by surface. Every one of these logs and verifies:
process-level handlers (uncaught exceptions, unhandled rejections), request
entry points, outbound calls (payload out, response in), store operations,
jobs and the work they spawn, retry paths, and initialization
(configuration, environment, dependencies). A surface that can fail
silently is a surface that was not instrumented.

Shared infrastructure (the one module every file imports; nothing
re-creates it):

- one shared pino logger; never `console.*`, never a second instance;
- child loggers for context — module scope and operation scope, constant
  fields bound once, never repeated per call;
- error serialization — every caught error flattened (message, name,
  stack, code, and its extra detail keys) before it is logged;
- redaction — secrets are logged as presence/shape, never as values;
- the verification helper — shape, value, and range checks (see §6).

Intent model:

- An **intent** is a unit of work with a goal — a request, a job, a run.
- A **trajectory** is the history the intent produces.
- Ids are W3C-shaped: a 32-hex trace id assigned at the intent's entry,
  16-hex step ids for its steps. Every record carries them. Work spawned by
  an intent (a job fanning out over items, a retry as a new attempt) gets a
  child intent that references its parent, so the history continues across
  boundaries.
- Ordering is total: timestamps plus a per-intent sequence number, so
  reading order equals occurrence order even when timestamps collide or
  clocks jump.

Output: one JSON stream per run — pino's flat JSON, one record per line —
the surface a reader filters by intent id. No side channels, no batched
backends, no replay machinery: the logs are read, not executed.

## 4. Record anatomy

Every record carries, at minimum:

- intent id, step id, per-intent sequence;
- timestamp and severity;
- event name — derived per §2, stable and low-cardinality; dynamic values
  live in fields, never in names;
- one plain sentence saying what happened;
- the semantic fields: shared keys with fixed meanings — failure
  classification, outcome, consequence, duration, identity and cause
  references;
- the data that moved — payload in and payload out wherever the step
  handles data, with secrets redacted but content visible, so the reader
  sees the error or sees it working;
- the verification verdict where the step verified something:
  expected / actual / where / verdict.

## 5. Failure taxonomy — four classes, one shape

1. **Thrown** — an exception escapes a step.
2. **Returned failure** — an error code or error body inside an otherwise
   successful response. The 200-carrying-an-error case. The verdict is the
   domain outcome, not the transport status; the status is evidence, never
   the verdict.
3. **Shape failure** — the value is not what it must be: missing fields,
   wrong types, out-of-range numbers, malformed ids, unexpected structure.
   Nothing threw, every transport said 200, and the data is garbage. The
   most dangerous class, because downstream code proceeds on it.
4. **Not failure** — cancellations, expected forks, "no data yet" polling,
   handled-and-recovered conditions, and library-generated exceptions that
   only restate a non-success status code (artificial exceptions). Logged as
   flow, never as errors.

Classes 1–3 all produce the same record shape: what was attempted (the
step's purpose), what was expected, what was found (actual payload inline),
classification, consequence (handled / escaped / terminal), and severity.

Severity by impact:

- FATAL — the run must stop (bad configuration at startup, unrecoverable
  state).
- ERROR — unexpected; the run continues or the caller must handle it.
- WARN — expected to be handled (timeouts, exhausted retries — one record
  at exhaustion, never one per attempt).
- DEBUG — not a problem (a request cancelled by the client).

One record per failure. An error handled and recovered is not re-logged as
an error at every layer; the record belongs to the step that owns the
failure. No double-recording, no swallowed errors.

## 6. The verification contract

Expected values are asserted against actual values at every point where
values enter, move, or leave:

- **Initializers** — environment, configuration, dependencies: asserted
  present, correctly typed, in range, before any work runs.
- **Requests** — the payload is logged before send; the response is logged
  and checked against its declared shape (fields, types, presence where
  presence is required). The declared shape is derived from what that call
  is for, at the call site — not from a global registry.
- **Results** — every function's result is verified against its expected
  shape and value before it is returned or passed on.
- **Throughout** — intermediate values are checked as they are produced,
  not only at the edges, so a failure is recorded at the step that produced
  it and never travels downstream.

The check record has the shape of a test assertion: **expected, actual,
where, verdict** — for example, "expected id: string(36), actual: number
12345, at: parseUser result". A failed check is a failure record (class 3)
at error severity, even when nothing threw and every transport said 200.

Success is redefined: a step's SUCCESS means the step completed AND its
result verified. Asserted, not assumed.

## 7. The reader model

    intent -> trajectory -> history

- Every record belongs to an intent. No orphans.
- Every consequential step logs what it was and how it turned out. No
  silent steps.
- Payloads are inline — a reader sees the actual content (the error text
  from the 200), never a pointer to a file they cannot open.
- The history of one intent reads start to finish, in order, and ends with
  its outcome.

This is the §1 reader test expressed as rules, and it is what the rubric
checks at the end.

## 8. Mapping from the original standard (logging.md / logger.js)

Carried as-is:

- one shared pino logger; never `console.*`; no second instance;
- child loggers — module scope and operation scope, constants bound once;
- lifecycle pairs — entry logged; START -> SUCCESS/error on every
  consequential step; success logs are half the signal, never skipped;
- error serialization on every catch; never a raw Error; log AND propagate,
  never swallow;
- secrets as presence/shape, never values; identifiers are safe to log;
  auth/cookie stripped from any headers;
- store operations — keys and field names logged, never values; not-found
  is a typed error;
- jobs and polling — no-data-yet is normal, not an error; terminal failures
  are typed;
- process handlers — uncaughtException and unhandledRejection typed and
  serialized; safe message out, full detail in;
- the anti-pattern list;
- the definition-of-done self-check.

Upgraded, same convention with a sharper edge:

- typed events stay mandatory, but the name is derived from the grammar in
  context — no registry;
- severity by impact — the fatal band is used; cancellation is not an
  error; an exhausted retry is one WARN record;
- external calls — the verdict is the domain outcome, not `res.ok`; a 2xx
  carrying an error body is a failure, same shape as a throw, error content
  inline; status is evidence;
- durationMs becomes a shared key; the per-intent sequence joins it for
  ordering;
- process exit — flush before exiting, so the crash record actually lands
  instead of being truncated.

Dropped, by decision:

- the EVENT constant catalog — replaced by the naming grammar (a catalog
  freezes meaning in advance and must be kept in sync; the grammar plus the
  agent's context derives the same consistency without the second
  artifact);
- replay machinery — digests, hash chains, random seeds, content-addressed
  payloads. The logs are read, not executed; the payload detail that serves
  reading was kept instead.

Nothing else from the original standard is lost. `logger.js` shrinks to
the shared singleton, the child-logger pattern, the error serializer, the
redaction rule, and the verification helper.

## 9. What we take from the two references, and why

From the OpenTelemetry semantic conventions:

- an operation is failed if it throws OR returns an error in another way —
  the definition that makes the 200-with-error a first-class failure;
- failures carry a classification key (their `error.type`), severity bands
  by impact, low-cardinality dotted event names, and exception attributes
  (type / message / stacktrace) as the error payload's shape;
- record fields: timestamp, severity, trace id, span id.

Rejected: adopting the OTel wire format or SDK as the logging stack. Pino
stays the writer; the conventions ride on top as field meanings, keeping
the door open to a collector later without changing anything generated.

From the OpenAI Agents tracing docs:

- the run model — a trace per workflow, parent links between spans, a group
  id tying related runs together;
- flush before exit — the crash record must land;
- redaction fails closed — if redaction fails, drop the record and log a
  fixed failure message containing no payload.

Rejected: batched export and backend machinery. One local stream.

From the trace-engineering notes (causal graph, state mutations,
deterministic replay, trace-to-memory):

- kept — cause references on records and parent links between intents, so a
  failure's originator is reachable by following references backwards;
- kept — the runtime-verification goal, made concrete as the verification
  contract (§6);
- kept — per-step metadata that serves reading: duration, outcome,
  payload summaries;
- dropped, by decision — deterministic replay: seeds, snapshots, before/
  after state-digest capture, hash chains. The logs are read, not
  re-executed. State changes are still logged as entity + operation + keys
  (per §8), without cryptographic machinery;
- out of scope — model/token usage; this standard governs generated
  application code, not model calls.

## 10. The deliverable

1. **The rubric** — one self-contained instruction file, used by the coding
   agent as its always-on generation guide: conventions, the derivation
   procedure, the verification contract, record anatomy, the failure
   taxonomy, anti-patterns, and a definition-of-done self-check. It doubles
   as the agent's own check while generating.
2. **Wiring** — the rubric is referenced from the environment the agent
   loads on every task, the role `kilo.jsonc` played for the previous
   setup, so "always" is a property of the configuration, not of the
   agent's memory.
3. **`logging.md`** — kept as the human-readable standard behind the
   rubric; on any disagreement, the rubric wins.

## 11. Decision log

- **No event catalog** — decision by the author; a fixed list forces
  selecting from labels instead of deriving meaning, and it duplicates as a
  second artifact to maintain. Consistency comes from the grammar and the
  shared keys instead.
- **No replay machinery** — decision by the author: we read the logs, we do
  not re-execute runs. Boundary capture survives only where it serves
  reading (payload content inline).
- **W3C-shaped ids** — same effort as any scheme, understood by every
  tracing tool, and it keeps real OpenTelemetry collectors reachable later
  at zero cost.
- **Shape contracts at call sites, not globally** — the expected shape is a
  property of what each boundary is for; declaring it where the call is
  made keeps it context-derived and avoids a registry.
- **presence() survives** — the no-secrets rule is unchanged; each field
  name states which quantity it carries (`tokenLength` vs `hasToken`), so
  one field never carries three meanings.
- **Verification is co-required with logging** — silent corruption (class
  3) is the failure class logs alone cannot catch; verification is what
  turns "it completed" into "it is correct".
- **Payload logging kept, redacted** — nothing can be verified or diagnosed
  that cannot be seen; secrets and credentials are the only exclusions.

## 12. Open items — settle before build

1. The rubric's exact form: single self-contained instruction file;
   criteria-with-levels versus requirement-plus-checks shape; its id and
   filename.
2. How it wires into the coding agent so it is always loaded, and where the
   file lives.
3. Whether the rubric embeds a small set of worked example records — to
   show what a readable trajectory looks like — without drifting into a
   catalog of types.
4. Confirmation that the §8 mapping is complete: anything else from
   `logging.md` that must survive verbatim.
