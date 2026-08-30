# dsh-auto-collapse

> A DeepSeek Harness Web client plugin that auto-collapses tool cards and Think blocks into one-line summaries. Enhanced with per-turn metrics bar (duration / token usage / tok/s, configurable), interaction awareness, state persistence, accessibility labels, and i18n — all without dsh-harmony dependency.
>
> **Core principle: the whole execution process is shown hierarchically and quantitatively.** Every piece of non-body system info (reasoning / tool calls / context injections / retry status rows) folds into expandable rows labeled with `category × count`, while the latest in-flight activity stays visible.
>
> 中文: [README.md](./README.md)

## What it does

`dsh-auto-collapse` is a pure front-end DOM plugin for the DeepSeek Harness Web chat UI. It collapses the working process into one-line summaries — tool calls and reasoning no longer fill the screen, giving the chat the collapsible look of the VSCode Codex desktop client, **and it also rewrites “Deep diving” to a configurable “Deep sleeping...”**. It never modifies message content — it only controls visibility of the working process.

## Preview

![Collapsed workflow](assets/screenshot.png)

## Features

- **Turn-level auto collapse** (Level 1): when a turn finishes, the whole working process collapses into a `已处理 X秒` (processed in Xs) row, leaving only the model's final text. Click to expand the full workflow (context injections → thinking → tool calls → intermediate text → final text).
- **Live in-progress summary bar**: while a turn is still running, a live summary row (`已工作 X秒` (worked for Xs) | tool calls / tokens…) sits at the very top of the workflow with a pulsing indicator and a ticking duration; it only reports live stats and never blocks streaming output. Once the turn completes, the clickable level-one row takes over. Aligns with dsh-turn-fold's running summary.
- **Second-level rows**: after expanding level one, tool-call groups and think blocks each collapse into a single chip row (`正在运行 {command}` / `运行了命令` / `编辑了文件` / `已思考` / `上下文注入`), click to expand/collapse; adjacent tool groups merge, while body text serves as a hard boundary (never merged across). **Cross-category merge between body texts**: think + tools + context injections + model-retry status rows of different categories merge into one chip labeled with each category × count (e.g. `2 reasoning steps · Bash ×2 · 2 context injections · 1 retry`). **Only 2+ adjacent non-body items fold**: a single tool call / single think / single context injection stays native (no chip). Live thinking is rendered solely by the native ReasoningRow; the chip no longer mirrors a "thinking…" title or live reasoning content.
- **Second-level granular counts**: a collapsed completed chip shows each category × count (`N reasoning steps · ToolName ×count · N context injections · N retries`, e.g. `Bash ×2 · Read ×1`); tool names are sorted by **count descending** (ties keep first-seen order), and a light-red `K failed` badge is appended when there are errors. Aligns with dsh-turn-fold's activityGroup.
- **PTC (run_code) sub-tool names**: in PTC mode, when a single `Code` card orchestrates multiple tool calls and DSH parses ≥1 concrete sub-tool name (Code + sub-tools occupy 2+ rows), it folds; the chip preferentially shows the parsed sub-tool names × count (e.g. `Bash ×2 · Read ×1`), falling back to `Code` only when no parsed sub-tool names are available.
- **Trailing tool-call description (any tool, not just Code)**: a completed second-level chip appends the "last tool call" description — `Code`'s description, `Bash`'s command, `Read`/`Grep`'s path, etc. are all extracted (a later tool overwrites an earlier one); display mode is configurable as always / on-hover / never, default always.
- **Standard-mode tool name parsing**: the tool name prefers `data-tool` and falls back to `data-sample` (bash keyed toolviews use the bash-sample chrome without `data-tool`); running state is read from the same root. This keeps standard-mode bash calls from degrading to `Tool ×N` and prevents a running bash row from being misread as finished and folded.
- **Keep the latest content visible while running**: while a turn is in progress, second-level chips stay collapsed and completed rows fold into the chip one by one (chip summary appends completed counts + the running command); the last `N` system rows (think / tool / context — any non-model-output content) stay fully visible and unfolded, with `N` configurable via the "keep rows while running" setting (default 3; 0 keeps nothing, folding running rows too). A running→ok state flicker never folds the newest command/think into the chip early. On turn close everything returns to the default collapsed state. A "thinking" block that starts right after tool rows forms its own block, so the completed tool chip above is not mislabeled "thinking" with both rows refreshing.
- **Third-level think merge**: expanding `已思考` shows consecutive think rows merged into one row titled `Think · first line`, click to reveal the merged content block; raw fourth-level rows never appear.
- **Native visual alignment**: 16px icon box / 14px glyph / 24px line height / 16px row gap; colors use DSH native tokens (`--dsw-alias-label-*`); think and command icons come from DSH native icons (`IconThinkOutline14` / `IconApiOutline14`).
- **Stream-friendly**: in-place `assistant-step` body updates, React node replacement, and out-of-order history mounting are reconciled on every pass; running rows use a smooth text pulse motion, disabled by `prefers-reduced-motion`.
- **Complete work-node coverage**: top-level `command` / `manual-compaction`, context nodes, and image-only finals follow the same turn semantics as tool calls.
- **Turn-level status row folding**: DSH native retry/failure/limit status rows ("Retried model request", terminal failure, "Output token limit reached") collapse with the fold; ones sitting between tool rows or right above a tool group are absorbed into that second-level chip, ones separated by body text fold only at level one.
- **Collapse on abnormal termination**: when a turn is stopped or interrupted and has no normal `turn-tail` boundary (a stopped/aborted tool row, or a terminal-failure / output-limit status row), it still generates a level-one row that collapses the working process; stopped turns append a "Stopped" label.
- **Configurable status text**: in Settings → Plugins → Plugin configuration, edit the status prompt (default `Deep sleeping...`); leaving it blank restores the official `Deep diving...`.
- **Configurable tool-call description display**: in Settings → Plugins → Plugin configuration, the "tool-call description" option controls how the trailing "last tool-call description" of a completed second-level chip is shown — `Always` (default) / `On hover` / `Never`, easing the visual density of description text next to the model output.
- **One-click expand/collapse all second-level folds**: `Shift + click` a level-one row expands that turn's every second-level chip (Shift+click again collapses them); `Ctrl/Cmd + Shift + E` expands/collapses every level-one and level-two fold globally. No extra UI — modifier key + shortcut.
- **Per-turn metrics bar**: each completed turn's summary row displays configurable metrics (duration, tool calls, model calls, input/output/reasoning tokens, cache hit/write tokens, cache hit rate, tok/s, time-to-first-token, and `contextDelta` = last model-call input tokens this turn minus last model-call input tokens previous turn; **first turn has no previous, baseline = 0, so it equals that turn's final input**). Data is injected via a shadow renderer directly from the React session snapshot (node.data.usage / turnTimings) and reproduced from records (duration uses `turnTimings`), matched by session + turn — immune to interruption/steering/session-switch DOM reordering.
- **Configurable metric fields with custom labels**: in Settings → Plugins → Plugin configuration, the "summary bar metrics" input accepts comma-separated field names; append `(custom label)` to a field name to override its display name (e.g. `inputTokens(Input context)`). Fields without a parsed label keep their default name.
- **Interruption-safe turn matching**: metrics are read from the module-level injector store keyed by `sessionId:turn:segOrdinal` (main↔subagent sessions never cross-contaminate same-numbered turns; interjection-split segments within a turn each report independent stats), turn attribution prefers the native `data-turn-tail`, and the live timer uses the record-level `turnStartTime` so switching main↔subagent never resets an in-progress turn's clock. Manual stop → new message, or mid-execution steering, never cross-contaminates turn statistics.
- **Fully reversible**: uninstalling (HMR stop) restores every collapsed/hidden/rewritten node.

## Install

Published npm package (recommended; uses the prebuilt release):

```bash
dsh plugin --profile web add "dsh-auto-collapse"
```

Install from GitHub when using the development version or following `main`:

```bash
dsh plugin --profile web add "github:a179-sanae/dsh-auto-collapse#main"
```

Restart the DSH web service (or trigger plugin HMR), then hard-refresh the page (`Ctrl+Shift+R`). No configuration needed.

## Development

### Project layout

```
src/fold.ts          core: FoldController (state machine) + findBlocks (block recognition) + collapse/expand logic + DOM-level turn-metrics extraction
src/turn-metrics.ts   turn-metrics injector: shadow renderer reads React session snapshot (node.data.usage / turnTimings) for per-turn token usage, tool calls, model calls, duration, and tok/s
src/client.ts         browser entry (plugin registration + metrics injector setup)
src/index.ts          host half
build.mjs         esbuild build (the client registration id lives in the banner)
deploy.mjs        safe deploy: validate → back up → replace → verified restart → hash check/rollback
cordis.patch.yml  profile tree mounting
test/             fake-DOM contract, race, session-switch, and 40-order permutation regressions
```

### Checks

```bash
npm run check
```

Runs TypeScript checking, a fresh build, and the complete regression suite.

### Quick deploy (local dev)

```bash
npm run deploy
```

Validates the plugin/DSH package identities and the process listening on port 3080, then creates a timestamped backup, replaces the bundle, restarts DSH, and verifies the served hash. Failures restore the old bundle. Override defaults with `DSH_AUTO_COLLAPSE_LIB`, `DSH_DIR`, `DSH_WEB_PORT`, and `DSH_LOG_DIR`.

### Publishing a new version

Update the `version` in `package.json`, then publish to npm (the `prepack` hook builds automatically):

```bash
npm publish --access public
```

For local development, you can pack a tgz without publishing:

```bash
npm pack --pack-destination <local-plugin-dir>
```

Point the plugin dependency in the profile's `package.json` to the new tarball and reinstall the plugin.

### Key mechanisms

- **Block recognition** (`findBlocks`): top-level nodes are classified as tool calls, command/manual-compaction cards, contexts, thinking, or body content; user/steering/turn-tail nodes are hard boundaries.
- **Segment reconciliation**: every pass rebuilds segments from current DOM order. The last `assistant-step` containing text or media is final; earlier bodies are intermediate work. Stable flow/node keys preserve UI state without one-shot mutation bookkeeping.
- **Duration**: streaming segments each track their own first running observation; historical segments parse official duration or the `timeStart`/turn-tail range. Whole minutes omit the seconds field.
- **React coexistence and reversibility**: replaced nodes rebind by stable key, removed level-one rows rebuild with their expansion state, and every inline `display` value is saved before mutation and restored exactly.

## License

MIT
