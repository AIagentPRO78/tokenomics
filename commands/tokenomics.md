---
name: tokenomics
description: |
  Cost & context intelligence for the current Claude Code session — exact spend,
  per-subagent/tool attribution, a context-degradation read, and ranked, provable
  recommendations.

  Usage: /tokenomics [command] [options]

  Commands:
    report      (default) cost + context + attribution + top recommendations
    attribute   cost & context by model, subagent, tool, skill
    advise      just the ranked recommendations
    route       routing advice (and scaffold a cost-routed subagent)
    eval        prove a delta: --before <a.jsonl> --after <b.jsonl>
    models      --check <model-id> — how an id is priced

  Examples:
    /tokenomics
    /tokenomics attribute
    /tokenomics advise
    /tokenomics models --check claude-fable-5
argument-hint: "[report|attribute|advise|route|eval|models] [options]"
allowed-tools: ["Bash"]
---

# /tokenomics

Run the bundled tokenomics CLI against **this** session's transcript and present the result.

Execute exactly this (it reads the session transcript offline; it makes no network calls):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/tokenomics.mjs" $ARGUMENTS --no-color
```

(If `$ARGUMENTS` is empty the CLI defaults to `report`.)

Then:

1. Show the CLI output to the user verbatim inside a fenced code block — do not paraphrase the numbers.
2. If there are recommendations, call out the single highest-severity one in a sentence and mention that its `prove it:` command can measure the actual delta.
3. If the CLI prints `no transcript found`, tell the user to pass `--transcript <path>` or run from the project directory.

Do not editorialize or re-estimate the costs — the CLI is the source of truth.
