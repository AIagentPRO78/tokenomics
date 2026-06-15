# tokenomics — Design Spec

> Token economics for Claude Code: see, attribute, and **prove** the cost and context of every session.

Status: v0.1.0 design — validated against live platform capabilities (recon 2026-06-15).

## 1. Problem

A Claude Code session spends two scarce resources at once — **context-window tokens** (which degrade quality as they fill: "attention budget", "context rot") and **dollars** (the same tokens, priced). Both are invisible in-session until something goes wrong: the model gets vague near the context cliff, or the monthly bill surprises you. Existing tools (`ccusage`, `ccstatusline`, usage monitors) are **passive displays** — they render the number but never tell you *what* is eating the budget or *what to do about it*, and they never prove a fix worked.

## 2. Goal

One plugin that makes the token economy **visible, attributable, and optimizable**, and that **proves** each optimization with a before/after token-delta measurement — mirroring Anthropic's own framing of context-engineering + evals as two halves of one discipline.

Success criteria (verifiable):

- From a real transcript, produce a **cost figure within rounding of the API's own accounting** (correct cache-tier and add-on math).
- Attribute cost and context **per model, per subagent, per skill, per tool** for a session.
- Surface the **top context consumers** and emit **concrete, actionable** advice (route this subtask to Haiku; this tool flooded context; compact now).
- A built-in **eval** that measures the token/$ delta of applying a recommendation and reports it like an experiment.
- **Future-proof**: a new model id (Fable 5's return, `claude-opus-5`, …) prices and routes correctly with **zero code change**.
- Install and get value with **one command + one slash invocation** (zero config); live HUD is a documented one-line opt-in.

## 3. What the platform actually allows (load-bearing constraints)

| Capability | Verdict | Consequence for design |
|---|---|---|
| Parse session transcript JSONL for exact per-turn `usage` | Solid | Primary data source; offline, no egress |
| `isSidechain` / `parentUuid` separate subagent turns | Solid | Per-subagent attribution feasible |
| statusLine stdin: `context_window.used_percentage`, size, `cost.total_cost_usd`, `transcript_path` | Solid | Live HUD source |
| Cost math (cacheRead 0.1×, write5m 1.25×, write1h 2×, web_search $0.01, ×0.5 batch, ×1.1 us-geo) | Solid | Deterministic offline pricing |
| Dynamically reroute the **live main-loop** model from plugin code | **Blocked** | Routing is *advisory* + static subagent frontmatter only |
| Trigger / retime / tune compaction | **Blocked** (PreCompact can only *block*) | Context control = warn + attribute + advise, never force |
| `/context` per-category breakdown programmatically | **Blocked** | Category attribution is *approximated* from the transcript, labelled as an estimate |
| Plugin ships a primary statusLine | Undocumented | Slash command is the zero-config surface; statusLine is opt-in |
| OTEL `claude_code.*` token/cost metrics with labels | Partial | Optional enrichment only — env vars don't cross subprocesses, so subagent cost comes from the transcript |

Honesty rule: the plugin never claims a capability the platform doesn't grant. "Auto-route" and "auto-compact" are presented as **advice + assists**, not magic.

## 4. Architecture

Pure-Node, **zero runtime dependencies** (only Node stdlib) — install is clone-and-go, and the supply-chain attack surface is nil (a deliberate security + virality choice). Tests use the Node built-in test runner.

```
tokenomics/
  .claude-plugin/
    plugin.json          manifest
    marketplace.json     so `plugin marketplace add <repo>` works directly
  src/
    models.mjs           model registry: exact id → family pattern → default; id normalization
    models.json          DATA: per-model {input,output} + family patterns + multipliers + addons
    pricing.mjs          usage object → cost breakdown (cache tiers, add-ons, batch, geo)
    transcript.mjs       locate + stream-parse JSONL → normalized turn records
    attribute.mjs        group turns → cost/context by model|subagent|skill|tool
    context.mjs          context-size signal, growth curve, top consumers, degradation state
    advisor.mjs          ledger → ranked, concrete recommendations (route / compact / tool-bloat)
    evals.mjs            before/after token-delta harness (the proof engine)
    format.mjs           render: money, tokens, bars/sparklines, tables, ANSI colour (TTY-aware)
    util.mjs             tiny shared helpers (no logic worth duplicating)
  bin/
    tokenomics.mjs       CLI: report | attribute | advise | route | eval | statusline
    statusline.mjs       thin statusLine entry (reads stdin JSON → one-line HUD)
  hooks/
    hooks.json               PreCompact only (silent compaction snapshot to state)
    precompact-snapshot.mjs  writes a marker; injects no context, never blocks
  commands/
    tokenomics.md        /tokenomics slash command → drives bin CLI
  agents/                pre-routed subagent presets (haiku-worker, sonnet-dev, opus-architect)
  skills/tokenomics/SKILL.md   when/how to reach for cost+context analysis
  test/                  node:test unit + integration over fixtures
  docs/DESIGN.md         this file
  README.md LICENSE CHANGELOG.md .gitignore package.json
```

### Data flow

```
transcript.jsonl ──parse──> [turn records] ──┬─ pricing ──> per-turn cost
                                             ├─ attribute ─> cost/context by {model,agent,skill,tool}
                                             ├─ context ───> size curve, top consumers, degradation
                                             └─ advisor ──> ranked recommendations
                                                                  │
                                          evals: run a recommendation's before/after ──> proven Δtokens/Δ$
```

### Module contracts (each independently testable)

- **models.mjs** — `priceFor(modelId) -> {input, output, source: 'exact'|'family'|'default', unknown: bool}`. Normalizes provider-prefixed/suffixed ids (`us.anthropic.…`, `…-v1:0`, `…@date`) before lookup. Pure; data from `models.json`.
- **pricing.mjs** — `costOfTurn(usage, modelId, opts) -> {inputCost, outputCost, cacheReadCost, cacheWrite5mCost, cacheWrite1hCost, addonsCost, total, breakdown}`. Constants for multipliers; `output_tokens` treated as already inclusive of thinking. `opts` carries `fastMode` (out-of-band; no usage flag) and overrides.
- **transcript.mjs** — `findTranscript({cwd, sessionId})` and `parseTranscript(path) -> {turns, meta}`. Streams the file line-by-line; tolerant of malformed/partial lines (never throws on one bad row). Each turn: `{ts, model, usage, isSidechain, agentName?, skillNames?, toolNames?, resultBytes}`.
- **attribute.mjs** — fold turns into grouped ledgers with cost+token totals and shares.
- **context.mjs** — current size, growth over turns, top context consumers (by tool_result size / cache growth), degradation tier (ok/watch/warn/critical) from `used_percentage`.
- **advisor.mjs** — pure function `recommend(ledger) -> [{kind, severity, title, detail, estSavingUsd?, evalCmd?}]`. Kinds: `route-subtask`, `tool-bloat`, `compact-now`, `cache-miss`, `unknown-model`.
- **evals.mjs** — `runEval(spec) -> {before, after, deltaTokens, deltaUsd, verdict}`; spec is a small declarative before/after over two transcripts or two runs.
- **format.mjs** — rendering only; respects `NO_COLOR`/non-TTY; never computes economics.

## 5. Features (v1)

1. **`/tokenomics`** (zero-config) → session report: total $, tokens, cache hit-rate, model mix, top context consumers, and the top 3 recommendations.
2. **`tokenomics attribute`** → cost/context table by subagent/skill/tool/model.
3. **`tokenomics advise`** → ranked, concrete actions, each with an estimated saving and a runnable `eval` to prove it.
4. **`tokenomics route`** → reads the ledger, recommends subagent model tiers, can scaffold a pre-routed subagent (static frontmatter).
5. **`tokenomics eval`** → before/after token-delta proof of a recommendation (the hiring-signal feature).
6. **statusLine HUD** (opt-in, one line) → live context gauge + $ with colour thresholds.
7. **Hooks** — a single PreCompact hook that silently snapshots compaction stats (pre/post tokens) to a per-session state file. Advisory only: it injects no context, never blocks compaction, and never mutates the session. (Kept deliberately minimal — a cost/context plugin must not itself bloat the window.)

## 6. Non-goals (YAGNI)

- No `ANTHROPIC_BASE_URL` gateway / traffic interception (security surface, leaves the plugin model).
- No silent model switching or forced compaction (platform-blocked and off-brand).
- No external telemetry, network calls, or account linkage. Fully offline.
- No hard USD cap enforcement (not enforceable on subscription sessions; advisory only).

## 7. Security posture (audited before release)

- Zero third-party runtime deps → no supply chain.
- Read-only over transcripts; writes only to the plugin's own state/report files under the session dir or stdout.
- No secrets, no network, no `eval`/dynamic-require of untrusted input, path-traversal-safe transcript resolution.
- Never embeds the operator's real identity/email in any artifact, UA, or commit.

## 8. Testing strategy

- Unit: pricing math (every model + cache tiers + add-ons + batch/geo), model registry fallback (exact/family/unknown), id normalization, transcript tolerance to malformed lines, advisor thresholds, formatter TTY/NO_COLOR.
- Integration: full parse→price→attribute→advise over a realistic fixture transcript; statusLine stdin contract; hook stdin/stdout contracts.
- Property-ish: cost is monotonic in tokens; cache read never costs more than fresh input; unknown model flagged.
- Target: 80%+ line coverage, 100% on pricing/models (money paths).

## 9. Future-proofing

- `models.json` is the single source of pricing truth; family-prefix patterns resolve unreleased/returning models. A `tokenomics models --check <id>` surfaces whether an id is priced by exact/family/default so drift is visible.
- Multipliers and add-on rates are data, not code.
- New hook events or statusLine fields degrade gracefully (unknown fields ignored; missing fields fall back).
