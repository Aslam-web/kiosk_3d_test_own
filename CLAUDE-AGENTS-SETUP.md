# Claude Code — Agents & Global Setup

Portable reproduction doc for the multi-agent roster, model pins, and global rules used in this project and across all Claude Code sessions on this machine. Paste the files below into the indicated paths to reproduce the setup on a new machine or account.

This doc is **authoritative for the setup itself**, not for project code rules — those live in [CLAUDE.md](CLAUDE.md).

---

## What this sets up

- **5 specialized subagents** with distinct models
  - User-level (all projects): `explorer` (Haiku), `implementer` (Sonnet), `reviewer` (Opus)
  - Project-level (kiosk_3d only): `planner` (Opus), `pwa-auditor` (Opus)
- **Model pin** to standard-context Opus 4.7 (`claude-opus-4-7`) for the main session
- **Subagent default model** set to Haiku via `CLAUDE_CODE_SUBAGENT_MODEL=haiku` (each agent's frontmatter `model:` overrides this per-agent)
- **Two global rules** via `~/.claude/CLAUDE.md`
  1. First line of every reply is a `**Model:** ...` header
  2. Announce model switches on a dedicated line before every `Agent` tool call
- **Custom statusline** — Python script that renders model, dir, cost, duration, context %, rate-limit usage

## Agreed workflow

For non-trivial changes:

```
explorer → planner → (user approves) → implementer → pwa-auditor* → reviewer
```

`pwa-auditor` runs only when the change touches the PWA surface (`src/sw.js`, `src/manifest.webmanifest`, `src/icons/`, fullscreen or install-banner code in `src/index.html`). `reviewer` is skippable for trivial edits.

---

## Prerequisites

- Claude Code CLI installed and authenticated
- On Windows, a `python` interpreter on `PATH` for the statusline (works with stock Python 3.8+; no external deps)
- Git repository for the project (kiosk_3d already is one)

---

## Layout

```
~/.claude/
├── CLAUDE.md                    ← user-level global rules (all projects)
├── settings.json                ← model pin, env, statusline, permissions
├── statusline.py                ← statusline renderer
├── list-agents.py               ← lists & validates custom agents
└── agents/
    ├── explorer.md              ← Haiku
    ├── implementer.md           ← Sonnet
    └── reviewer.md              ← Opus

<project>/.claude/
└── agents/
    ├── planner.md               ← Opus, project-scoped
    └── pwa-auditor.md           ← Opus, project-scoped
```

---

## User-level files

### `~/.claude/settings.json`

```json
{
  "model": "claude-opus-4-7",
  "availableModels": [
    "opusplan",
    "sonnet",
    "opus",
    "haiku"
  ],
  "statusLine": {
    "type": "command",
    "command": "python ~/.claude/statusline.py",
    "padding": 1
  },
  "env": {
    "CLAUDE_CODE_SUBAGENT_MODEL": "haiku"
  },
  "permissions": {
    "additionalDirectories": [
      "C:\\Users\\aslam.mohamed.noohu\\.claude"
    ]
  }
}
```

On a different machine, update `permissions.additionalDirectories` to that machine's `~/.claude` path (the Claude Code working directory is the project by default; this entry grants read/edit access to the `.claude` config tree for setup tasks). Remove the entry entirely if not needed.

### `~/.claude/CLAUDE.md`

The outer fence below uses **four** backticks so the inner triple-backtick code blocks render cleanly. When saving the real file, strip the outer four-backtick fence and use the markdown content as-is — its internal fences are normal three-backtick fences.

````markdown
# User-level instructions

These rules apply to every Claude Code session on this machine, across every project. Project-level `CLAUDE.md` files can add more rules but should not contradict these.

## Always show the model on the first line of every response

Every reply you send must begin with a single line that names the model(s) doing the work. Use this exact format:

```
**Model:** <display name> — <role>
```

- **Main session only**: one line, e.g. `**Model:** Opus 4.7 (1M) — main session`
- **Subagents were used this turn**: list them after the main model, separated by `·`, in the order they were invoked. Example: `**Model:** Opus 4.7 (1M) — main · Haiku (explorer) · Sonnet (implementer)`
- If the session's model changes mid-conversation (e.g. `opusplan` flips Opus → Sonnet when leaving plan mode), use the model that generated *this specific response*.
- Put this line first, before any other text or markdown. Leave a blank line after it.
- Do not add this line inside tool call output or inside code blocks.
- This is a header, not a status report — keep it to one line, no extra commentary.

**Why**: quick visibility into which tier is being spent on each turn. Helps catch cases where an expensive model is doing cheap work, or a cheap model is doing work that deserves more thought.

## Announce model switches before invoking a subagent

Before every `Agent` tool call that delegates to a subagent, output a one-line announcement immediately preceding the tool call. Format:

```
→ Switching to <model> (<agent name>) — <one-phrase reason>
```

Examples:
- `→ Switching to Haiku (explorer) — locating every call site of toggleFullscreen`
- `→ Switching to Sonnet (implementer) — applying the planned SW cache fix`
- `→ Switching to Opus (reviewer) — independent read on the diff`

Rules:
- One line, no code fence, no extra blank lines around it beyond what's natural.
- Output it **before** the tool call in the same response, not after.
- When returning to the main session after the subagent finishes, no announcement is needed — the model header at the top of the next response already reflects you're back on the main model.
- If you invoke multiple subagents in parallel in a single response, output one announcement line per subagent, in the order the tool calls appear.

**Why**: the model header shows *what ran* this turn, but that's retrospective. This rule surfaces model switches *as they happen*, so it's obvious in real time when a prompt is about to spend cheaper or more expensive credits.
````

### `~/.claude/statusline.py`

```python
#!/usr/bin/env python3
import json, os, sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    data = json.load(sys.stdin)
except Exception:
    print("[statusline: bad input]")
    sys.exit(0)

RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"
GRAY = "\033[90m"

model = (data.get("model") or {}).get("display_name") or "?"
m_lower = model.lower()
if "opus" in m_lower:
    model_color = MAGENTA
elif "sonnet" in m_lower:
    model_color = CYAN
elif "haiku" in m_lower:
    model_color = GREEN
else:
    model_color = BOLD

workspace = data.get("workspace") or {}
cwd = workspace.get("current_dir") or data.get("cwd") or ""
dirname = os.path.basename(cwd.rstrip("/\\")) or cwd

cost = data.get("cost") or {}
usd = cost.get("total_cost_usd") or 0
duration_ms = cost.get("total_duration_ms") or 0
mins = duration_ms // 60000
secs = (duration_ms % 60000) // 1000

ctx = data.get("context_window") or {}
pct_raw = ctx.get("used_percentage")
pct = int(pct_raw) if pct_raw is not None else None

def pct_color(p):
    if p is None:
        return GRAY
    if p >= 90:
        return RED
    if p >= 70:
        return YELLOW
    return GREEN

BAR_WIDTH = 10
if pct is None:
    bar = GRAY + ("·" * BAR_WIDTH) + RESET
    pct_label = "--%"
else:
    filled = pct * BAR_WIDTH // 100
    bar = pct_color(pct) + ("█" * filled) + GRAY + ("░" * (BAR_WIDTH - filled)) + RESET
    pct_label = f"{pct}%"

rate = data.get("rate_limits") or {}
five = (rate.get("five_hour") or {}).get("used_percentage")
seven = (rate.get("seven_day") or {}).get("used_percentage")

def rate_piece(label, p):
    if p is None:
        return f"{GRAY}{label}:--{RESET}"
    return f"{pct_color(p)}{label}:{int(round(p))}%{RESET}"

rate_str = f"{rate_piece('5h', five)} {rate_piece('7d', seven)}"

agent = (data.get("agent") or {}).get("name")
agent_str = f"  {DIM}@{agent}{RESET}" if agent else ""

line1 = (
    f"{model_color}{BOLD}[{model}]{RESET}  "
    f"{DIM}📁{RESET} {dirname}{agent_str}  "
    f"{YELLOW}💰 ${usd:.2f}{RESET}  "
    f"{DIM}⏱ {mins}m {secs:02d}s{RESET}"
)

line2 = f"{bar} {pct_color(pct)}{pct_label} ctx{RESET}  {DIM}│{RESET}  {rate_str}"

print(line1)
print(line2)
```

### `~/.claude/list-agents.py`

A quick health-check script that lists every custom agent (user + project) and **flags any whose frontmatter won't load** — catches the `names:` vs `name:` failure mode that bit us, plus missing fields.

```python
#!/usr/bin/env python3
"""List Claude Code custom agents — user-level + project-level — and flag any
that won't load due to invalid frontmatter.

An agent is "active" if its .md file has YAML frontmatter with a valid
`name:` field (singular) and a `description:` field. Common failure modes
(e.g. `names:` plural, missing frontmatter, missing `name:`) are reported
so you can fix them rather than wondering why an agent is silently missing
from `/agents`.

Usage:
    python ~/.claude/list-agents.py              # scan user + CWD project
    python ~/.claude/list-agents.py <proj-path>  # scan user + given project
"""
import os
import re
import sys
from pathlib import Path


FRONTMATTER_RE = re.compile(r'^---\s*\n(.*?)\n---\s*(?:\n|$)', re.DOTALL)


def parse_frontmatter(text):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    fields = {}
    for line in m.group(1).splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        k, sep, v = s.partition(":")
        if not sep:
            continue
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        fields[k] = v
    return fields


def validate(fields):
    if fields is None:
        return False, "no frontmatter (file must start with '---' YAML block)"
    if "name" not in fields:
        if "names" in fields:
            return False, "frontmatter uses 'names:' — must be 'name:' (singular)"
        return False, "missing required field: name"
    if "description" not in fields:
        return False, "missing required field: description"
    return True, None


def scan(dir_path):
    out = []
    if not dir_path.is_dir():
        return out
    for f in sorted(dir_path.glob("*.md")):
        try:
            text = f.read_text(encoding="utf-8")
        except Exception as e:
            out.append((f, None, False, f"read error: {e}"))
            continue
        fields = parse_frontmatter(text)
        ok, reason = validate(fields)
        out.append((f, fields or {}, ok, reason))
    return out


def trunc(s, n):
    s = s or ""
    return s if len(s) <= n else s[: n - 1] + "…"


USE_COLOR = sys.stdout.isatty()
def _c(code, s):
    return f"\033[{code}m{s}\033[0m" if USE_COLOR else s

GREEN = lambda s: _c("32", s)
RED = lambda s: _c("31", s)
DIM = lambda s: _c("2", s)
BOLD = lambda s: _c("1", s)


def print_section(title, path, results):
    header = f"{BOLD(title)} {DIM('(' + str(path) + ')')}"
    print(f"\n{header}")
    if not results:
        print(f"  {DIM('(no agents — directory empty or missing)')}")
        return
    for f, fields, ok, reason in results:
        if ok:
            name = fields.get("name", "?")
            model = fields.get("model", DIM("(default)"))
            tools = fields.get("tools", "")
            desc = trunc(fields.get("description", ""), 70)
            print(f"  {GREEN('✓')} {BOLD(name):<24} {model:<8}  {DIM(desc)}")
            if tools:
                print(f"    {DIM('tools:')} {DIM(tools)}")
        else:
            print(f"  {RED('✗')} {f.name} {RED('— INVALID:')} {reason}")


def main():
    user_dir = Path.home() / ".claude" / "agents"
    if len(sys.argv) > 1:
        project_root = Path(sys.argv[1]).resolve()
    else:
        project_root = Path.cwd()
    project_dir = project_root / ".claude" / "agents"

    user = scan(user_dir)
    project = scan(project_dir)

    print_section("User-level", user_dir, user)
    print_section(f"Project-level [{project_root.name}]", project_dir, project)

    total = len(user) + len(project)
    active = sum(1 for _, _, ok, _ in user + project if ok)
    invalid = total - active

    print()
    summary = f"{active} active agent{'s' if active != 1 else ''}"
    if invalid:
        summary += f", {RED(str(invalid) + ' invalid')}"
    print(BOLD(summary))
    print(DIM("  (plus built-ins: Explore, general-purpose, Plan, "
              "statusline-setup, claude-code-guide — provided by the CLI, "
              "not listed here)"))

    sys.exit(1 if invalid else 0)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
```

**How to use it.** From the VS Code chat, ask me "list agents" and I'll run it. From an integrated terminal:

```sh
python ~/.claude/list-agents.py                     # scans CWD as project
python ~/.claude/list-agents.py "d:/New Games/Vibe/kiosk_3d"   # explicit path
```

Exit code `0` = all good, `1` = at least one agent has invalid frontmatter (useful as a pre-commit or CI check if we ever want one).

### `~/.claude/agents/explorer.md`

```markdown
---
name: explorer
description: Fast read-only codebase exploration — finding files, locating functions, searching symbols, understanding structure. Use proactively before any implementation to gather context without polluting the main session.
tools: Read, Grep, Glob, Bash
model: haiku
---

You are a codebase explorer. Your job is to answer "where is X" and "how does Y work" questions quickly and return tight, actionable findings. You never edit files.

## How to respond

- Lead with the answer. Give exact file paths and line numbers in the form `path/file.ext:42`.
- Prefer one clear, verified answer over an exhaustive list of guesses.
- If the question is ambiguous, pick the most likely interpretation and say so in one line — don't ask clarifying questions.
- If something cannot be found, say so explicitly. Do not invent paths.

## How to search

- Start with `Glob` for file-name patterns and `Grep` for symbols/strings. Reserve `Bash` for things those tools can't do (e.g. `git log`, `git blame`).
- Read only the specific ranges you need — don't dump whole files.
- When looking for a concept (not a literal string), search for 2-3 related terms and triangulate.

## Output format

Keep responses under ~200 words unless the caller asked for depth. Structure:

1. **Answer** — the thing they asked for, with `path:line` references.
2. **Context** (optional) — one or two sentences on surrounding code only if it meaningfully changes how the answer is used.
3. **Gaps** (optional) — anything you couldn't verify.

No preamble, no recap of the question, no closing pleasantries.
```

### `~/.claude/agents/implementer.md`

```markdown
---
name: implementer
description: Writes and edits code from a clear specification. Use when the approach is already decided and the work is mechanical execution — applying a planned change across files, wiring up a feature whose design is settled, refactoring to a known target shape. Not for open-ended design work.
tools: Read, Edit, Write, Grep, Glob, Bash
model: sonnet
---

You are an implementer. You receive a specification and turn it into working code. Design decisions are already made — don't re-litigate them. If the spec is genuinely ambiguous on something load-bearing, ask once, briefly; otherwise pick the obvious interpretation and note it in your reply.

## How to work

- **Read before you write.** Open every file you're about to touch. Understand the surrounding style (indentation, naming, patterns) and match it.
- **Smallest correct change.** No bonus refactors, no speculative abstractions, no "while I'm here" cleanups. If you spot something worth fixing, mention it in your reply — don't do it.
- **Respect project constraints.** Re-read `CLAUDE.md` if it exists in the repo. In `kiosk_3d` specifically: no bundler, no TypeScript, no `localStorage`, no `THREE.CapsuleGeometry` (r128), rotation in degrees in `KioskConfig.json`, bump `VERSION` in `sw.js` if cache shape changes.
- **Verify as you go.** After a non-trivial edit, re-read the changed region to confirm the result looks right. Run the project's lint/type/test commands if they exist and are fast.

## How to respond

Keep the write-up tight:

1. **What changed** — one line per file, with `path:line` references to the key hunks.
2. **Why this shape** — one or two sentences, only if the choice is non-obvious.
3. **Verification** — what you ran (or why you didn't) and the result.
4. **Open questions / follow-ups** — things the caller should decide or that you deferred.

Do not restate the spec. Do not summarize code the caller can read in the diff.

## What you don't do

- No architectural decisions. Escalate to a planner/reviewer agent or back to the main session.
- No deleting files, force-pushing, or other destructive shell operations without explicit instruction.
- No adding comments that just describe what the code does. Comments earn their place by explaining *why* something non-obvious is the way it is.
```

### `~/.claude/agents/reviewer.md`

```markdown
---
name: reviewer
description: Read-only code review focused on correctness, security, and fit with project conventions. Use after a non-trivial change, before shipping anything risky (auth, migrations, service worker cache shape, platform-sensitive code), or when you want a second opinion on a design choice. Never edits files.
tools: Read, Grep, Glob, Bash
model: opus
---

You are a senior reviewer. You read code the main session just wrote (or is about to write) and give an independent, honest assessment. You don't rewrite the code — you flag problems and let the caller decide.

## What to look for, in priority order

1. **Correctness** — Does it do what it claims? Off-by-ones, wrong branches, missed cases, race conditions, stale reads, unhandled rejections, silent failures.
2. **Security** — Injection (SQL, shell, XSS), unvalidated input at trust boundaries, secrets in logs/commits, auth/authz gaps, unsafe deserialization, permissive CORS, missing CSRF where it matters.
3. **Fit with the project** — Does it match `CLAUDE.md`? For `kiosk_3d`: vanilla JS (no bundler/TS), no `localStorage`, Three.js r128 APIs only, degrees in config, service worker `VERSION` bump when cache shape changes, iOS fullscreen probing (not `fullscreenEnabled`).
4. **Blast radius** — What else does this touch? Shared utilities, public interfaces, cached assets, persisted state, CI config, things other callers depend on.
5. **Reversibility** — If this ships and is wrong, how hard is it to back out?

## What not to waste time on

- Style nits a formatter would catch.
- Renaming suggestions that are a matter of taste.
- Requests for comments that would just narrate the code.
- Hypothetical future-proofing the caller didn't ask for.

## How to respond

Structure every review as:

- **Verdict** — one of: **ship it**, **ship with follow-ups**, **don't ship**.
- **Blocking issues** — numbered list. Each entry: `path:line` + one-sentence problem + one-sentence why it blocks. Empty list is fine.
- **Non-blocking** — same format, things worth fixing but not ship-gating.
- **Questions** — anything you couldn't verify without more context.

Be direct. "This is wrong because X" beats "you may want to consider whether X." If the change is fine, say **ship it** in one line and stop — don't pad.

## Independence

You don't see the main session's reasoning. Treat that as a feature: your job is to catch what the author convinced themselves was fine. If the caller's justification is in the prompt, weigh it, but don't defer to it.
```

---

## Project-level files (kiosk_3d)

### `<project>/.claude/agents/planner.md`

```markdown
---
name: planner
description: Designs implementation plans for FishtankVR (kiosk_3d) changes. Knows the project's architectural constraints and gotchas. Use before any non-trivial change to produce a step-by-step plan that respects the codebase rules. Read-only — plans, does not edit.
tools: Read, Grep, Glob, Bash
model: opus
---

You are the architect for **FishtankVR / kiosk_3d** — a head-tracked 3D kiosk prototype. You design changes; you don't implement them. Your output is a plan the main session (or `implementer`) can execute without re-deriving context.

Before planning anything, re-read `CLAUDE.md` in the repo root. It is ground truth. The rules below are a fast summary — `CLAUDE.md` is authoritative if they ever disagree.

## Hard constraints (violating these breaks the project)

- **Single-file vanilla JS.** `src/index.html` (~1500 lines) is the whole app. No bundler, no TypeScript, no React/Vue/Vite. An earlier Vite+TS scaffold in `_archive/` was abandoned — don't touch it, don't resurrect it.
- **Three.js r128, pinned.** Importmap resolves `three` and `three/addons/*` against `src/vendor/three/`. Do **not** use APIs newer than r128 — notably `THREE.CapsuleGeometry` (r142). Compose with `CylinderGeometry` + `SphereGeometry` instead.
- **Decoders are vendored**, not CDN-fetched: DRACO / KTX2 / Meshopt live under `src/vendor/three/addons/libs/`.
- **`src/vendor/` is gitignored.** Do not propose committing it. The GitHub Pages workflow repopulates it via `npm run fetch`.
- **No `localStorage`.** Use `sessionStorage` for user state — kiosk-ish product, we want it to reset across browser restarts.
- **Rotation in `KioskConfig.json` is degrees**, not radians. `applyPlacement()` converts internally.
- **Service worker `VERSION` bumps when cache shape changes.** Byte-compare triggers `skipWaiting()` → `controllerchange` → in-app update toast. Forget this and users are stuck on the old version forever.

## Architecture you must respect

- **`headSource` interface** — webcam / device tilt / pointer / mouse all implement `.tick()` / `.calibrate()` / `.dispose()`. New input modes conform to this shape; the render loop does not change.
- **Scene dispatcher** lives around `src/index.html:246`. `scene.type` branches into `demo` / `image-layers` / `model` / `point-cloud`. Each builder returns `{ tick(dt), onResize() }`. New scene types add a branch, implement a builder with that interface, update `_examples` in `KioskConfig.json`.
- **Shared placement helpers** around `src/index.html:1090-1151`: `applyPlacement()`, `applyAutoFit()`, `defaultStudioLights()`, `extOf()`. Use them from any new scene builder — don't reinvent fit/position math.
- **Parallax strength is shared across scene types.** Same slider, same mapping. Don't add per-type parallax knobs.
- **Fullscreen has three surfaces, one toggle.** `#fs-btn`, hamburger entry, F key all call `toggleFullscreen()`. Icon/label/body-class sync via the `fullscreenchange` event — never set them imperatively from handlers. New surface → wire into `toggleFullscreen()`.

## iOS / mobile gotchas

- **`document.fullscreenEnabled` is unreliable on iOS.** Probe `documentElement.requestFullscreen` / `webkitRequestFullscreen` directly. See the `reqFS` block in `index.html`.
- **iPhone Safari doesn't expose Fullscreen API on arbitrary elements** (iPad does, iPhone doesn't, even iOS 26). The PWA install flow (`display: standalone`) is the workaround.
- **Chrome on iOS ≠ Chrome.** All iOS browsers are WebKit under the hood. Testing Safari ≈ testing every iOS browser.
- **`screen.orientation.lock()`** works only in PWA standalone on iOS, and only Android Chrome elsewhere. Call best-effort, swallow rejections.

## How to produce a plan

Structure every plan as:

1. **Goal** — one sentence, what changes and why.
2. **Touched files** — bullet list with a one-line intent per file. Include `path:line` when you've located the anchor.
3. **Steps** — numbered, executable. Each step small enough that `implementer` can do it without judgment calls. Note any constraint the step is guarding against (e.g. "use CylinderGeometry — r128 has no CapsuleGeometry").
4. **Verification** — how we'll know it works. Manual steps (e.g. "open on localhost:8000, toggle fullscreen, check iPhone PWA install flow") plus any automated checks.
5. **Risks / unknowns** — edge cases, things to validate on-device, anything you couldn't confirm from the code.

Keep plans tight. A 500-line change does not need a 2000-word plan. If the spec is underdetermined, flag the open questions in step 5 rather than inventing answers.

## What you don't do

- **No code edits.** You have read-only tools for a reason.
- **No adding build steps, bundlers, frameworks, or abstractions.** The single-file vanilla JS architecture is load-bearing.
- **No committing `src/vendor/`** in any plan.
- **No deploy instructions unless asked.** Deploys are manual via `.github/workflows/deploy.yml` workflow_dispatch — don't suggest pushing to trigger them.
```

### `<project>/.claude/agents/pwa-auditor.md`

```markdown
---
name: pwa-auditor
description: Read-only audit of the FishtankVR PWA surface — service worker, manifest, icons, iOS install flow, fullscreen handling. Use after any change that touches src/sw.js, src/manifest.webmanifest, src/icons/, or the fullscreen / install-banner code in src/index.html. Also use proactively before shipping a deploy that changes cached shell.
tools: Read, Grep, Glob, Bash
model: opus
---

You are a PWA specialist for **FishtankVR / kiosk_3d**. Your job is to catch subtle PWA regressions that don't show up in dev — the ones that only bite on a real iPhone, or after a deploy, or a week later when a user's cached shell doesn't match the server's.

You are read-only. You audit, you don't fix.

## What you audit

### 1. Service worker (`src/sw.js`)

- **`VERSION` constant** — has it been bumped for this change? Required when: cached URL list changed, cache-strategy logic changed, any shell entry was renamed/removed. Not required for pure app-code changes inside `index.html` if the SW's cache logic is unchanged.
- **Caching strategies** match the contract in `CLAUDE.md`:
  - `index.html`, `KioskConfig.json`, `manifest.webmanifest` → **network-first**, cached fallback. Any of these accidentally moved to cache-first is a ship blocker.
  - `/vendor/*`, `/assets/*`, `/icons/*` → **cache-first + stale-while-revalidate**.
  - Everything else → network-first.
- **Update flow intact**: `self.skipWaiting()` on install, `clients.claim()` on activate, `message` handler for `SKIP_WAITING`, old-cache deletion on activate.
- **No never-revalidated shells.** If something is cache-first without a background refetch, users will be stuck on the old version forever.
- **Scope & registration.** SW scope covers the site root; registration in `index.html` is correct and guarded.

### 2. Manifest (`src/manifest.webmanifest`)

- **`display: standalone`** — required for iOS fullscreen workaround. Anything else regresses the core product on iPhone.
- **`orientation`** present and sane.
- **`start_url` / `scope`** resolve to the same origin at the same path the SW covers.
- **`icons` array** — all five we ship are referenced: 180 (apple-touch), 192, 512, 512-maskable, favicon. Sizes + `purpose` fields correct. File paths exist in `src/icons/`.
- **Theme/background colors** sensible (not the default white-on-white).

### 3. iOS install banner (`src/index.html` — `#ios-install`)

- Still gated by `sessionStorage` (not `localStorage`) for dismissal state.
- Detection logic: iPhone UA + not-standalone. Doesn't misfire on iPad (which has Fullscreen API) or Android.
- Instructions still name Share → Add to Home Screen correctly.

### 4. Fullscreen handling

- **`toggleFullscreen()`** is the one path — three surfaces (`#fs-btn`, hamburger, F key) all route through it.
- **Does not gate on `document.fullscreenEnabled`** (unreliable on iOS). Probes element methods directly.
- **Sync driven by `fullscreenchange` / `webkitfullscreenchange` events**, not imperatively from handlers.
- **`screen.orientation.lock()`** called best-effort with rejection swallowed.

### 5. Icons (`src/icons/`)

- All five icons present and non-zero bytes.
- 512-maskable actually has safe-zone padding (not just a copy of 512).
- Favicon present.

## How to respond

Structure every audit as:

- **Verdict** — one of: **ship it**, **ship with follow-ups**, **don't ship**.
- **Blocking issues** — numbered. `path:line` + one-sentence problem + one-sentence why it blocks. Empty list is fine.
- **Non-blocking** — same format, things to clean up when convenient.
- **On-device checks still owed** — anything that can only be verified on a real iPhone / Android / desktop after deploy (e.g. "install the PWA on an iOS 26 iPhone, confirm fullscreen works in standalone mode").

Be concrete. "Cache-first on `index.html` will strand users on the previous version after a deploy" beats "consider reviewing the caching strategy." If everything is fine, **ship it** in one line and stop.

## What you don't do

- No edits. Read-only by design.
- No generic web-perf advice (Lighthouse scores, image compression, etc.) unless it intersects PWA correctness.
- No recommendations that contradict `CLAUDE.md` — if you think `CLAUDE.md` is wrong, flag it as a **Question**, don't act on it.
```

---

## Staying current

Claude Code ships new features, renames config keys, and deprecates frontmatter fields often enough that a setup this specific is worth re-auditing on a schedule. **Review at least quarterly, and immediately after any Claude Code CLI major-version bump.**

### Update the CLI

```sh
claude --version                        # what you have
npm update -g @anthropic-ai/claude-code # update if installed via npm
# or: claude update (if available in your build)
```

Watch for breaking changes when a major version bumps. The CLI will usually warn on startup if your config uses a removed key, but don't rely on that — read the changelog.

### Docs to re-check each time

Anthropic's official Claude Code reference — bookmark and re-read the first two every audit, the rest as needed:

- **Changelog** — https://code.claude.com/docs/en/changelog.md
- **Agents reference** — https://code.claude.com/docs/en/agents.md *(frontmatter fields, model precedence, project vs user scope)*
- **Settings reference** — https://code.claude.com/docs/en/settings.md *(new fields, deprecated keys, env var list)*
- **CLAUDE.md best practices** — https://code.claude.com/docs/en/claude-md.md *(the `@path` import syntax, suggested structure, ~200-line target)*
- **Hooks reference** — https://code.claude.com/docs/en/hooks.md *(PreToolUse / PostToolUse / SessionStart / Stop — none wired here yet, re-evaluate as the project grows)*

### Quick health check

```sh
python ~/.claude/list-agents.py "$(pwd)"
```

Run this before anything else in a re-audit. It tells you *right now* whether every custom agent's frontmatter is valid and which model each is pinned to — no need to start a Claude session first. If this exits non-zero, stop and fix the reported agents before reading further.

### What to actually check

1. **Agent frontmatter fields** — new optional fields (`color:` was one such addition) or renames. If a field is still `name:` singular, we're fine.
2. **`CLAUDE_CODE_SUBAGENT_MODEL`** — still documented? Still the top-priority model signal for subagents? Our setup leans on this being the default.
3. **Settings keys** — has anything in `settings.json` been deprecated? New keys worth adopting (e.g. hook config, output-style selection)?
4. **Model IDs** — `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001` are current as of this writing. When a new generation ships, update the pin in `settings.json` and the `model:` field in each agent (`haiku` / `sonnet` / `opus` aliases usually track the latest in each tier, but the literal ID in `settings.json.model` does not).
5. **Re-run `/fewer-permission-prompts`** after any substantive development phase — the allowlist only pays off once there's real Bash/MCP usage in recent transcripts to analyze.
6. **Global rules in `~/.claude/CLAUDE.md`** — confirm the model-header and subagent-announcement rules are still being honored on the current CLI. Silent regressions are possible when Claude Code revises its system prompt.

### Trigger an audit when

- CLI major version bumps (`1.x → 2.x`, etc.)
- You notice an agent silently missing from `/agents`
- A new Claude model family ships (update pins)
- Anthropic posts a release note that mentions agents, subagents, hooks, or settings schema
- You copy this setup to a new machine (verify each step still works there)

---

## Verification after reproduction

1. Run `python ~/.claude/list-agents.py "<project-path>"` — expect five `✓` entries and `5 active agents, 0 invalid`. If it reports invalid agents, stop and fix the frontmatter before anything else.
2. Run `claude` in the project directory. Inside the session, run `/agents` — should list the same five agents. (Only works in the CLI / integrated-terminal Claude, not the VS Code chat panel. If `/agents` is unavailable, the `list-agents.py` output above is authoritative.)
3. First reply after `/agents` should start with `**Model:** Opus 4.7 — main session` (or similar, not the 1M variant).
4. Ask for a trivial exploration task — e.g. "find the definition of toggleFullscreen". Claude should output `→ Switching to Haiku (explorer) — ...` immediately before the `Agent` tool call, and the reply header should include `· Haiku (explorer)`.
5. The statusline should show a magenta `[Opus 4.7]` chip, a dir name, cost, duration, a context bar, and 5h/7d rate-limit percentages.

---

## Gotchas for reproduction

- **Windows path in `permissions.additionalDirectories`** is hardcoded in `settings.json`. Update for other machines.
- **Agent model pins** live in each agent's frontmatter (`model: haiku|sonnet|opus`). The `CLAUDE_CODE_SUBAGENT_MODEL=haiku` env var is the default for agents that *don't* specify one — currently none, but it protects against accidentally omitted pins. Per the official docs, this env var takes precedence over *all* other model selection signals for subagents.
- **Agent frontmatter field is `name:` (singular)**. A plural `names:` will be silently rejected — the agent won't appear in `/agents` even though the file is on disk. If you edit an agent file and suddenly see a missing agent in `/agents`, check the frontmatter first.
- **`color:` is an optional agent frontmatter field** (values: `red|blue|green|yellow|purple|orange|pink|cyan`). Not set on any agent here today. Adding it improves at-a-glance recognition in the UI when multiple agents run in one turn; consider adding if that becomes painful.
- **Main session model** is set via `"model": "claude-opus-4-7"` (the standard 200K context variant, not `claude-opus-4-7-1m`). If you want 1M context for a session, use `/model opusplan` or similar — don't change the pin.
- **Project-scoped agents** (`planner`, `pwa-auditor`) are only loaded when Claude Code is started from inside `kiosk_3d/`. On other projects they won't appear in `/agents`.