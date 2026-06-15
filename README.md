# tokenomics

**See, attribute, and _prove_ the cost and context of every Claude Code session.**

📄 **Documentation & homepage:** [aiagentpro78.github.io/tokenomics](https://aiagentpro78.github.io/tokenomics/)

A Claude Code session spends two scarce resources at once — the **context window** (which degrades quality as it fills) and **dollars** (the same tokens, priced). Both are invisible in-session until something goes wrong. `tokenomics` makes them visible, attributes them to the model / subagent / tool / skill that spent them, and gives you concrete advice you can **prove** with a before/after eval.

It reads your session transcript **offline**. No network calls, no telemetry, no account linkage, zero runtime dependencies.

```
tokenomics — session report
session ab54f620… · main

$0.9030  across 42 turns · 18.4K out · cache hit 71%

context  ████████████████░░░░░░░░ 67% getting tight

cost by model
model            cost     share  turns  src
───────────────  ───────  ─────  ─────  ─────
claude-opus-4-8  $0.7421  82%    31     exact
claude-haiku-4-5 $0.1609  18%    11     exact

main vs subagents
channel    cost      share  turns
─────────  ────────  ─────  ─────
main loop  $0.5102   56%    24
subagents  $0.3928   44%    18

top context consumers (tool output)
tool   context  calls  share
─────  ───────  ─────  ─────
Read   412.0KB  19     61%
Bash   180.3KB  23     27%

recommendations
[high] Route mechanical subagents off claude-opus-4-8  ~save $0.31
      Subagent turns cost $0.3928 on an Opus-class model. Mechanical fan-out is
      Haiku-shaped — pin those subagents to a cheaper tier (model: haiku).
      prove it: tokenomics eval --before <opus-run>.jsonl --after <haiku-run>.jsonl
```

## Why it's different

Every other usage tool is a **passive display** — it shows the number and stops. `tokenomics` closes the loop:

- **Attribution, not just a total.** Cost and context split by model, by subagent vs main loop, by tool, by skill. You learn _what_ spent the money.
- **A degradation read, not just a gauge.** It knows when "attention budget" is getting thin and tells you to act before quality drops.
- **Advice you can prove.** Every recommendation ships with an `eval` that measures the real token/$ delta. No hand-waving.

## Install

```
/plugin marketplace add AIagentPRO78/tokenomics
/plugin install tokenomics@tokenomics
```

Then, in any session:

```
/tokenomics
```

That's the whole zero-config path. For a live HUD in your prompt, add one line to `~/.claude/settings.json` (optional):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /ABSOLUTE/PATH/TO/tokenomics/bin/statusline.mjs"
  }
}
```

Replace `/ABSOLUTE/PATH/TO/tokenomics` with your install location (run `/plugin` to see where it installed, or just `git clone` the repo anywhere and point at its `bin/statusline.mjs`). The HUD reads Claude Code's statusLine stdin and renders a context+cost gauge.

## Commands

```
/tokenomics                         session cost + context + attribution + top recommendations
/tokenomics attribute               the breakdown only (model / subagent / tool / skill)
/tokenomics advise                  ranked recommendations, each with a "prove it" eval
/tokenomics route                   routing advice
/tokenomics route --scaffold cheap-worker --model haiku   write a cost-routed subagent preset
/tokenomics eval --before a.jsonl --after b.jsonl         prove a delta (verdict + $/token saved)
/tokenomics models --check claude-fable-5                 how a model id is priced
```

Or run the CLI directly: `node bin/tokenomics.mjs <command>`.

Common options: `--transcript <path>`, `--cwd <dir>`, `--session <id>`, `--json`, `--no-color`, `--fast-mode`.

## How it works

Claude Code writes a per-session transcript (`~/.claude/projects/<cwd>/<id>.jsonl`) with an exact `usage` object on every turn. `tokenomics` streams that file and computes:

- **Cost** with correct cache-tier math (cache read 0.1×, 5-minute write 1.25×, 1-hour write 2×), web-search add-ons, and batch / data-residency modifiers. `output_tokens` already includes thinking, so it is never double-counted.
- **Context** from the prompt size per turn, plus the live fill level from the statusLine feed.
- **Attribution** using `isSidechain` to separate subagents from the main loop, and tool/skill calls joined to their results.

## What it deliberately does _not_ do

Honesty matters more than a flashy claim:

- It **does not silently switch your model.** Claude Code doesn't let a plugin reroute the live model, so routing is delivered as advice plus static subagent presets (`model: haiku` frontmatter) you opt into.
- It **does not force compaction.** A plugin can't trigger it — so `tokenomics` warns and suggests `/compact`, it never surprises you.
- It **makes no network calls** and stores nothing about you. Everything is computed locally from the transcript.

## Future-proof pricing

Pricing lives in [`src/models.json`](src/models.json) as data, with **family-prefix patterns** so a returning or brand-new model is priced with **zero code change**:

```
tokenomics models --check claude-fable-5     # exact
tokenomics models --check claude-opus-5-0    # priced by family pattern
tokenomics models --check claude-unheardof   # conservative default, clearly flagged
```

When a new model ships, add one line to `models.json` (or rely on the family pattern). Cache multipliers and add-on rates are data too.

## Development

Pure Node, no dependencies. Tests use the built-in runner:

```
npm test            # 94 tests
npm run test:coverage
```

## License

MIT © AIagentPRO78
