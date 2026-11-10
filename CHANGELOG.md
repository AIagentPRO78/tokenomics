# Changelog

All notable changes to **tokenomics** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [Unreleased]

### Security
- Report, `advise`, `route`, `eval`, `models`, statusLine and `--json` output: strings taken
  from a transcript (session id, branch, model ids, tool names) are stripped of terminal
  escape sequences and control characters, kept to one line, and length-capped.
- The tool-bloat recommendation's `prove it:` line no longer embeds the tool name; it is now
  the fixed `tokenomics eval --before <a>.jsonl --after <b>.jsonl` (the old
  `attribute --tool …` form used options the CLI never implemented).
- The CLI rejects unknown options, options missing their value, and stray arguments instead
  of ignoring them.
- `/tokenomics` pre-approves only the bundled CLI invocation instead of all of Bash, and no
  longer pastes raw arguments into the command line.
- PreCompact marker directory and files are created owner-only (`0700` / `0600`).

### Fixed
- PRIVACY.md, README and DESIGN.md now describe the PreCompact marker file as it is actually
  written (session id, trigger, transcript path, timestamp — not token counts).

## [0.1.0] — 2026-06-15

Initial release.

### Added
- Exact, offline **cost accounting** from the session transcript JSONL — correct cache-tier
  math (read 0.1×, 5m-write 1.25×, 1h-write 2×), web-search add-on, batch and data-residency
  multipliers; `output_tokens` treated as already inclusive of thinking.
- **Attribution** of cost and context by model, subagent (`isSidechain`), skill, and tool.
- **Context** signal: live size, growth curve, top consumers, and a degradation tier.
- **Advisor**: ranked, concrete recommendations (route a subtask to a cheaper tier, tool-bloat,
  compact-now, cache-miss, fast-mode cost).
- **Eval harness**: before/after token-delta proof for a recommendation.
- **statusLine HUD** (opt-in) and an advisory **PreCompact hook** (silent compaction snapshot).
- **Future-proof model registry**: exact-id → family-pattern → conservative-default lookup, so
  returning/new models (Fable 5, Opus 5, …) price and route with zero code change.
