# Privacy Policy

**Project:** tokenomics — a Claude Code plugin
**Last updated:** 2026-11-11

## TL;DR

**tokenomics collects nothing and sends nothing.** It runs entirely on your own
machine, reads your local Claude Code session transcript, and makes **no network
requests**. There is no telemetry, no analytics, no account, no tracking, and no
third‑party runtime dependencies.

The one thing it stores by itself is a small **local** marker file, written each
time a session is compacted. It records the session id, what triggered the
compaction, and the path of that session's transcript on your disk. It never
leaves your machine. Section 1.2 lists every field.

This document is intentionally specific so you can verify every claim against the
public source code.

---

## 1. The plugin

### 1.1 What it reads

tokenomics reads the **session transcript JSONL files** that Claude Code writes
under `~/.claude/projects/`. The plugin does not create these files — Claude Code
does — and it only reads them.

From each turn it uses a small set of **metadata** fields:

- the model id (e.g. `claude-opus-4-8`),
- token usage counts (input, output, cache read/write),
- tool and skill **names** invoked,
- the `isSidechain` flag (subagent vs. main loop),
- timestamps, git branch, and session id,
- the **byte size** of a tool result (used to attribute context consumption).

It also reads two small JSON inputs that Claude Code passes to it on stdin: the
statusLine payload (only if you enable the optional HUD) and the PreCompact hook
input described in 1.2.

It does **not** parse, retain, or transmit the **substance** of your prompts,
your code, your files, or your tool outputs. It measures how large a tool result
was; it does not keep what was in it.

### 1.2 What it writes

- The report to your **terminal** (stdout).
- A per‑session **compaction marker file** at
  `~/.claude/tokenomics/state/<session>.compactions.jsonl`, written by the
  PreCompact hook (`hooks/precompact-snapshot.mjs`). The hook is registered in
  `hooks/hooks.json`, so it runs whenever the plugin is enabled and Claude Code is
  about to compact a session, manually or automatically; the plugin has no setting
  that turns it off. Each run appends one JSON line with exactly these four fields:
  - `sessionId` — the session id from the hook input, with every character other
    than a letter, digit, `_` or `-` replaced by `_`, cut to 128 characters
    (`unknown` if there was none). The same value is the `<session>` part of the
    file name.
  - `trigger` — the hook input's `trigger` (or `matcher`) value, for example
    `manual` or `auto`; `null` if absent.
  - `transcriptPath` — the hook input's `transcript_path`: the **full local path**
    of the session's transcript file; `null` if absent. That path normally
    includes your home directory (and so your OS user name) and a folder named
    after the project directory you were working in.
  - `at` — the hook input's `timestamp` value if it has one, otherwise `null`.

  The file holds **no token counts, no prompts, no code and no tool output**.
  Nothing in the plugin reads these files today, and the plugin never deletes or
  rotates them, so they stay until you remove them; deleting
  `~/.claude/tokenomics/` at any time is safe. The hook creates the `tokenomics/`
  and `state/` directories readable by your user only (mode `0700`) and each
  marker file as `0600`. A directory or file that an earlier version of the hook
  already created keeps the permissions it was created with (your system
  default, typically `0755` / `0644`).
- When you explicitly run `tokenomics route --scaffold`, a subagent preset file
  **you requested**, under your project's `.claude/agents/`.

### 1.3 What it does NOT do

- **No network requests of any kind.** No telemetry, no analytics, no crash or
  error reporting, no "phone home," no update checks.
- **No third‑party services, SDKs, or runtime dependencies.** It uses only the
  Node.js standard library.
- **No cookies, no account, no login.** It creates no device or user identifiers
  of its own; the marker file in 1.2 records Claude Code's session id and a
  transcript path, locally only.
- **No collection or transmission** of prompts, source code, file contents,
  credentials, secrets, or personal data.
- **No selling or sharing of data** — because none is collected, there is nothing
  to sell or share.

### 1.4 Verify it yourself

The source is public and dependency‑free, so the policy above is auditable:

- There are **no networking imports** (`http`, `https`, `net`, `fetch`,
  `dgram`, `tls`) anywhere in the code.
- There is **no** `eval`, `Function`, `child_process`, or dynamic `import()` of
  untrusted input.
- It runs fully **offline** — disconnect from the internet and it works
  identically.

```bash
# from a clone of the repo, this should print nothing:
grep -rnE "https?:|fetch\(|require\('(http|https|net|dgram|tls)'|child_process" src bin hooks
```

---

## 2. The documentation website

The documentation site at **https://aiagentpro78.github.io/tokenomics/** is a
static page. It is separate from the plugin and is disclosed here for
completeness:

- It is hosted on **GitHub Pages**. GitHub may collect standard server access
  logs (such as IP address and user agent) as part of serving any page. See the
  [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- The page currently loads web fonts from **Google Fonts**
  (`fonts.googleapis.com` / `fonts.gstatic.com`). When those fonts load, Google
  may receive your IP address. See the
  [Google Privacy Policy](https://policies.google.com/privacy).
- The site sets **no cookies** and runs **no analytics or tracking scripts**.

If you prefer zero third‑party requests while viewing the docs, you can read the
same content in this repository's `README.md` and `docs/` files, which load
nothing external.

---

## 3. Data sharing and third parties

The plugin shares **no data with anyone**, because it collects none. The only
third parties involved are the hosting/CDN providers of the **documentation
website** described in Section 2 — not the plugin.

## 4. Children's privacy

tokenomics is a developer tool, is not directed at children, and collects no
personal data from anyone.

## 5. Changes to this policy

Any changes are committed to this file in the public repository with an updated
"Last updated" date. There is no separate notification channel because the plugin
does not have your contact information.

## 6. Contact

Questions or concerns? Open an issue:
**https://github.com/AIagentPRO78/tokenomics/issues**

---

*This policy describes the behavior of the tokenomics plugin and its
documentation site. It is provided in good faith and is not legal advice.*
