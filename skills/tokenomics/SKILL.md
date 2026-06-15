---
name: tokenomics
description: Use when the user asks about Claude Code session cost, token spend, the bill, why a session got expensive, what is filling or bloating the context window, whether a subagent should run on a cheaper model, or wants to prove a token/cost optimization actually saved money. Analyzes the session transcript offline and returns exact cost, attribution, and provable recommendations.
---

# tokenomics — cost & context intelligence

This skill reads the current session's transcript (exact, offline — no network) and turns it into money, attribution, and **provable** advice.

## When to reach for it

- "How much has this session cost?" / "Why is this so expensive?"
- "What's eating my context window?" / "Why did the model get vague?"
- "Should this subagent be on Haiku instead of Opus?"
- "Did that change actually save tokens?" (prove it with an eval)
- Pricing a model id, including new/returning ones (Fable 5, Opus 5, …).

## How to use it

Run the bundled CLI; it is the source of truth for every number:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/tokenomics.mjs" <command> [options]
```

Commands:

- `report` (default) — headline cost, context gauge, cost-by-model, main-vs-subagent split, top context consumers, and the top recommendations.
- `attribute` — the breakdown without the advice.
- `advise` — ranked recommendations only. Each carries a `prove it:` eval command.
- `route` — routing advice; `route --scaffold <name> --model haiku` writes a cost-routed subagent preset into `.claude/agents/`.
- `eval --before <a.jsonl> --after <b.jsonl>` — before/after token & $ delta with a verdict. This is how you *prove* a recommendation worked.
- `models --check <model-id>` — shows whether an id is priced exactly, by family pattern, or by the conservative default.

Common options: `--transcript <path>`, `--cwd <dir>`, `--session <id>`, `--json`, `--no-color`, `--fast-mode`.

## What it can and cannot do (be honest with the user)

- CAN: compute exact cost from the transcript (correct cache-tier math), attribute it by model / subagent / tool / skill, read the live context fill level, and recommend concrete actions.
- CANNOT: silently switch the live model or force a compaction — those are platform-blocked. Routing is delivered as advice + static subagent frontmatter; compaction is a `/compact` nudge. Never tell the user the plugin will auto-route or auto-compact for them.

## Interpreting results

- High **subagent** share on an Opus-class model → route mechanical subagents to a cheaper tier (`route --scaffold`).
- A single tool dominating **top context consumers** → narrow that tool's output or hide it behind a summarizing subagent.
- Context tier `warn`/`critical` → suggest `/compact` or dumping durable state to a file.
- Low **cache hit-rate** with heavy input → keep the early context stable so cache reads (0.1×) replace fresh input.

Always offer to run the matching `eval` to prove a recommendation before claiming a saving.
