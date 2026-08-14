# dsh-auto-collapse

> A DeepSeek Harness Web client plugin that auto-collapses tool cards and Think blocks into one-line summaries, so the chat keeps only what the model says.
>
> 中文: [README.md](./README.md)

## What it does

`dsh-auto-collapse` is a pure front-end DOM plugin for the DeepSeek Harness Web chat UI, **and it also rewrites "Deep diving" to "Deep sleeping"**. It never modifies message content — it only controls visibility of the working process:

- **Turn-level auto collapse**: when a turn finishes, the whole working process collapses into a `已处理 X秒` (processed in Xs) row, leaving only the model's final text. Click to expand the full workflow (context injections → thinking → tool calls → intermediate text → final text).
- **Second-level rows**: after expanding level one, tool-call groups and think blocks each collapse into a single chip row (`正在运行 {command}` / `运行了命令` / `已思考`). Adjacent tool groups merge; body text is a hard boundary (never merged across).
- **Third-level think merge**: expanding `已思考` shows the consecutive think rows merged into one row titled `Think · first line`, click to reveal the merged content block. Raw fourth-level rows never appear.
- **Native visual alignment**: 16px icon box / 14px glyph / 24px line height / 16px row gap; colors use DSH native tokens (`--dsw-alias-label-*`); think and command icons come from DSH native icons (`IconThinkOutline14` / `IconApiOutline14`).
- **Stream-friendly**: think summaries update without MutationObserver feedback loops; running animation is scale/opacity only (no layout participation); animations stop under `prefers-reduced-motion`.
- **Fully reversible**: uninstalling (HMR stop) restores every collapsed/hidden/rewritten node.

## Install

```bash
dsh plugin --profile web add "github:a179-sanae/dsh-auto-collapse#main"
```

Restart the DSH web service (or trigger plugin HMR), then hard-refresh the page (`Ctrl+Shift+R`). Mounting is provided by the in-package `cordis.patch.yml`; no duplicate insert needed at the profile layer.

## Configuration

None.

## Development

### Project layout

```
src/fold.ts       core: FoldController (state machine) + findBlocks (block recognition) + collapse/expand logic
src/client.ts     browser entry (plugin registration)
src/index.ts      host half
build.mjs         esbuild build (the client registration id lives in the banner)
deploy.mjs        quick deploy: build → overwrite installed copy → restart service → verify
cordis.patch.yml  profile tree mounting
```

### Quick deploy (local dev)

```bash
npm run deploy
```

Builds, overwrites the locally installed copy, restarts the service and verifies the served bundle. Path constants live at the top of `deploy.mjs` — adjust per machine; not applicable without a local DSH install.

### Publishing a new version

```bash
npm pack --pack-destination <local-plugin-dir>   # packing auto-triggers the build via the prepack hook
```

Point the plugin dependency in the profile's `package.json` to the new tarball and reinstall the plugin.

### Key mechanisms

- **Block recognition** (`findBlocks`): top-level message elements are classified as tool piles / pure-think messages / body-text messages; body text is a hard boundary — `Think1-body-Think2` carries Think2 as a leftover row absorbed by the next pile, or by its host message's block at the end of the flow so no stray think row survives a finished turn.
- **Turn collapse**: `turn-tail` / new user message / steering are turn boundaries; on completion only the host that actually contains final body text stays visible — body-less tool/think hosts are hidden entirely (removes the blank gap between `已处理` and the final text).
- **Duration**: streaming turns time from `turnStartMs`; historical turns diff `timeStart` (turn start) against the turn-tail (end); formats `X秒` / `X分Y秒`, whole minutes drop the seconds (`15分00秒` → `15分`), hour-level `X小时` / `X小时Y分`.
- **React coexistence**: block/row references are refreshed every pass; click handlers work through per-pass block bindings (no cross-pass closure references); plugin nodes removed by React re-renders are self-healed.

## License

MIT
