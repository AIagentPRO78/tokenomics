# Changelog

All notable changes to **tokenomics** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

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
