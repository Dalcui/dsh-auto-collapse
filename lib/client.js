window.__ModuleLoader__.load({id:"dsh-codex-fold",factory:function(require){
"use strict";
var __dshcfBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name2 in all)
      __defProp(target, name2, { get: all[name2], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client.ts
  var client_exports = {};
  __export(client_exports, {
    apply: () => apply,
    inject: () => inject,
    name: () => name
  });

  // src/fold.ts
  var STYLE_ID = "dshcf-style";
  var TOOL_LABELS = {
    bash: "Bash",
    pwsh: "Pwsh",
    read: "Read",
    web_fetch: "Read",
    web_search: "Search",
    grep: "Search",
    glob: "Search",
    write: "Write",
    edit: "Edit",
    run_code: "Code",
    cordis_package_inspect: "Inspect",
    cordis_runtime_inspect: "Inspect",
    cordis_run: "Run",
    cordis_stop: "Stop",
    cordis_undefine: "Remove"
  };
  var CHIP_CSS = `
.dshcf-chip {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
  /* chip \u63D2\u5728\u5757\u5BBF\u4E3B\uFF08flowItem\uFF09\u5185\uFF0C\u4EAB\u53D7\u4E0D\u5230\u884C\u7684 row-gap 16px\uFF1B
     \u5C55\u5F00\u6001\u8865 margin-bottom \u5BF9\u9F50\u884C\u95F4\u8282\u594F\uFF1B\u6536\u8D77\u6001\u884C\u5DF2\u9690\u85CF\uFF0C\u82E5\u4ECD\u8865
     margin \u4F1A\u4E0E\u5757\u95F4 gap \u53E0\u52A0\u6210 32px\uFF0C\u6240\u4EE5\u6536\u8D77\u6001\u4E3A 0\u3002 */
  margin-bottom: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-chip[aria-expanded="true"] {
  margin-bottom: 16px;
}
.dshcf-chip:hover {
  background: transparent;
}

/* leading\uFF1A\u56FA\u5B9A 14x14\uFF08\u601D\u8003\u5757 = \u539F\u751F think \u56FE\u6807\uFF1B\u5DE5\u5177\u5757 = \u539F\u751F command
   \u56FE\u6807 IconApiOutline14\uFF0C\u514B\u9686\u81EA\u771F\u5B9E GenericCommandCard leading\uFF0C\u627E\u4E0D\u5230\u65F6
   \u9000\u56DE\u7EC8\u7AEF\u5C0F\u65B9\u5757\uFF09\uFF0C\u884C\u9AD8 24px \u4E0E\u539F\u751F\u884C\u5BF9\u9F50\uFF1B\u8FD0\u884C\u4E2D\u8DF3\u52A8\u3002svg \u5C3A\u5BF8\u7531\u5404\u81EA
   width/height \u5C5E\u6027\u51B3\u5B9A\uFF08command 14x14\u3001think 14x14\u3001\u7EC8\u7AEF 12x10 \u515C\u5E95\uFF09\uFF0C
   \u4E0D\u5728\u6B64\u5904\u5F3A\u5236\u3002 */
.dshcf-chip .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.dshcf-chip .dshcf-leading svg {
  display: block;
  color: var(--dsw-alias-label-tertiary);
}
.dshcf-chip.running .dshcf-leading svg {
  animation: dshcf-bounce 1.2s ease-in-out infinite;
  color: var(--dsw-static-deepseek-500, #4d6bfe);
}
@keyframes dshcf-bounce {
  0%, 100% { transform: scale(1); opacity: 0.45; }
  50% { transform: scale(1.2); opacity: 1; }
}

/* \u51FA\u9519\u7EA2 / \u4E2D\u65AD\u7425\u73C0\uFF08\u9759\u6B62\u6001\uFF09\u3002 */
.dshcf-chip.error:not(.running) .dshcf-leading svg {
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.dshcf-chip.stopped:not(.running) .dshcf-leading svg {
  color: var(--dsw-alias-state-warning-primary, #f5a524);
}

.dshcf-chip .dshcf-chip-title {
  flex: none;
  font-weight: 400;
}
.dshcf-chip .dshcf-chip-sep {
  flex: none;
  width: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.5));
}
/* \u6458\u8981\u4E0D\u6491\u6EE1\uFF08flex 0 1\uFF09\uFF0C\u8BA9 chevron \u7D27\u8DDF\u5728\u6587\u672C\u53F3\u65B9\u800C\u975E\u884C\u5C3E\u3002 */
.dshcf-chip .dshcf-chip-summary {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* \u6298\u53E0\u884C\u6587\u5B57\uFF1A\u590D\u7528 DSH \u539F\u751F label token\uFF08\u5DE5\u5177\u884C\u540C\u6E90\uFF09\uFF0C\u533A\u522B\u4E8E\u6B63\u6587\u7EAF\u767D\u3002 */
.dshcf-chip .dshcf-chip-title {
  color: var(--dsw-alias-label-primary);
}
.dshcf-chip .dshcf-chip-summary {
  color: var(--dsw-alias-label-tertiary);
}
/* \u5DE5\u5177\u884C\u6458\u8981\uFF08\u547D\u4EE4/\u8DEF\u5F84\uFF09\u7B49\u5BBD\u5B57\u4F53 + \u4EE3\u7801\u886C\u5E95\uFF08\u7D20\u6750 Codex \u540C\u6B3E\uFF09\u3002
   \u884C\u9AD8\u4E0E chip \u4E00\u81F4\uFF0824px\uFF09\uFF0C\u6D41\u5F0F\u66F4\u65B0\u65F6\u6458\u8981\u5355\u884C ellipsis \u4E0D\u6362\u884C\u4E0D\u6491\u9AD8\u3002 */
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
  font-size: 12px;
  line-height: 24px;
  background: rgba(127, 127, 127, 0.14);
  border-radius: 4px;
  padding: 0 6px;
}
.dshcf-chip[data-kind="tool"] .dshcf-chip-summary:empty {
  background: none;
  padding: 0;
}

/* "\u5DF2\u5904\u7406"\u884C\uFF1A\u6700\u7EC8\u8F93\u51FA\u51FA\u73B0\u540E\u5DE5\u4F5C\u8FC7\u7A0B\u6574\u4F53\u9690\u85CF\uFF0C\u53EA\u7559\u8FD9\u4E00\u884C + \u65F6\u957F\u3002 */
.dshcf-processed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: none;
  background: none;
  font: 400 12px/20px system-ui, -apple-system, "Segoe UI", sans-serif;
  /* \u5BF9\u9F50 DSH \u539F\u751F\u5DE5\u5177\u884C\u6458\u8981\u7684\u6B21\u7EA7\u5C42\u7EA7\uFF08label-tertiary\uFF09\u3002 */
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}
.dshcf-processed:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-3, rgba(127, 127, 127, 0.13));
}
.dshcf-processed:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
}
/* "\u5DF2\u5904\u7406"\u884C\u53F3\u4FA7\u5C0F\u7BAD\u5934\uFF08\u5E38\u9A7B\uFF0C\u7D20\u6750 Codex \u540C\u6B3E\uFF1A\u7D27\u8D34\u6587\u672C\u3001\u53EF\u70B9\u51FB\u5C55\u5F00/\u6536\u8D77\uFF09\u3002 */
.dshcf-processed .dshcf-processed-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.55;
  transition: transform 0.25s ease, opacity 0.1s ease;
}
.dshcf-processed:hover .dshcf-processed-chevron {
  opacity: 0.9;
}
.dshcf-processed[aria-expanded="true"] .dshcf-processed-chevron {
  transform: rotate(45deg);
}

/* chevron\uFF1A\u9ED8\u8BA4\u9690\u85CF\uFF0Chover/focus \u6D6E\u73B0\uFF0C\u5C55\u5F00\u65F6\u65CB\u8F6C 90\xB0\uFF08Codex \u540C\u6B3E\uFF09\u3002 */
.dshcf-chip .dshcf-chevron {
  flex: none;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.5; /* \u5E38\u9A7B\u53EF\u89C1\uFF08\u7D20\u6750 Codex \u540C\u6B3E\uFF09\uFF0Chover \u52A0\u6DF1 */
  transition: opacity 0.1s ease, transform 0.25s ease;
}
.dshcf-chip:hover .dshcf-chevron,
.dshcf-chip:focus-visible .dshcf-chevron,
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  opacity: 0.9;
}
.dshcf-chip[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(45deg);
}
.dshcf-chip:focus-visible {
  outline: 2px solid var(--dsw-alias-state-focus-ring, rgba(77, 107, 254, 0.8));
  outline-offset: 2px;
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .dshcf-chip.running .dshcf-leading svg { animation: none; }
}
`;
  var FoldController = class {
    constructor() {
      this.observer = null;
      this.raf = 0;
      this.timer = 0;
      this.disposed = false;
      this.flow = null;
      /** host 元素 → 它的 chip（每个簇一张）。 */
      this.chips = /* @__PURE__ */ new Map();
      /** host 元素 → 展开状态（按流容器元素隔离，切换会话不串状态）。 */
      this.expandedByHost = /* @__PURE__ */ new WeakMap();
      /** 最近一轮 pass 见过的全部行（stop 时统一还原）。 */
      this.allRows = [];
      /** host → 该块需要随折叠的容器（工具组元素）。 */
      this.blockContainers = /* @__PURE__ */ new Map();
      /** 行 → 进入 running 的时间戳（完成态时长用）。 */
      this.rowStarts = /* @__PURE__ */ new WeakMap();
      /** host → 该块全部完成后的固定耗时（ms），新一轮运行会重置。 */
      this.blockElapsed = /* @__PURE__ */ new Map();
      /** 已见过的正文消息元素：新正文（模型最终输出）出现时收起工作过程。 */
      this.seenBodyNodes = /* @__PURE__ */ new WeakSet();
      /** 已出现但尚有 running 行的回合边界；状态变更后继续尝试收尾。 */
      this.pendingBoundaries = /* @__PURE__ */ new Set();
      /** 已整体隐藏的块宿主（工作过程收进 "已处理" 行）。 */
      this.hiddenHosts = /* @__PURE__ */ new WeakSet();
      /** 已被某个 "已处理" 行认领的块宿主（每块只收一次，展开/收起不影响）。 */
      this.claimedHosts = /* @__PURE__ */ new WeakSet();
      /** 中间正文消息（assistant-step，非最终输出）→ 属于哪个 entry（整条折叠用）。
       * 强引用 Map：WeakMap 的键可能在 pass 间被 GC，导致折叠状态丢失。 */
      this.middleByHost = /* @__PURE__ */ new Map();
      /** "已处理"行 → 它控制的块宿主、时长与挂载点（自愈重建用）。 */
      this.processedRows = /* @__PURE__ */ new Map();
      /** 本轮最早开始运行的时间戳（"已处理"时长用）。 */
      this.turnStartMs = null;
      /** 被改写为 Deep sleeping 的原生状态文本，卸载时按节点恢复。 */
      this.turnStatusTexts = /* @__PURE__ */ new Map();
    }
    start() {
      if (this.disposed) return;
      injectStyle();
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-selected", "data-state"]
      });
      this.schedule();
    }
    stop() {
      this.disposed = true;
      if (this.raf !== 0) cancelAnimationFrame(this.raf);
      if (this.timer !== 0) clearTimeout(this.timer);
      this.observer?.disconnect();
      applyRows(this.allRows, [...this.blockContainers.values()].flat(), true);
      for (const host of this.middleByHost.keys()) host.style.display = "";
      for (const [, entry] of this.processedRows) {
        for (const h of entry.hosts) h.style.display = "";
      }
      this.middleByHost.clear();
      for (const [host, chip] of this.chips) {
        host.style.display = "";
        chip.remove();
      }
      this.chips.clear();
      for (const row of this.processedRows.keys()) row.remove();
      this.processedRows.clear();
      this.pendingBoundaries.clear();
      this.blockElapsed.clear();
      restoreTurnStatus(this.turnStatusTexts);
      removeStyle();
    }
    schedule() {
      if (this.disposed || this.raf !== 0) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.pass();
      });
      if (this.timer !== 0) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = 0;
        if (this.raf !== 0) {
          this.raf = 0;
          this.pass();
        }
      }, 60);
    }
    /** 一轮重放：重算堆积 → 应用折叠/展开 → 摆放并更新 chip → 替换状态行。 */
    pass() {
      if (this.disposed) return;
      const flow = findFlow();
      this.flow = flow;
      if (flow === null) {
        for (const chip of this.chips.values()) chip.remove();
        this.chips.clear();
        return;
      }
      const blocks = findBlocks(flow);
      const hosts = /* @__PURE__ */ new Set();
      for (const anchor of takeNewAnchors(flow, this.seenBodyNodes)) {
        if (isTurnEnd(anchor)) this.pendingBoundaries.add(anchor);
      }
      for (const boundary of [...this.pendingBoundaries]) {
        if (!boundary.isConnected || this.processTurn(blocks, boundary)) {
          this.pendingBoundaries.delete(boundary);
        }
      }
      this.healProcessedRows(flow);
      for (const block of blocks) {
        const { host, rows, containers } = block;
        hosts.add(host);
        this.blockContainers.set(host, containers);
        if (this.hiddenHosts.has(host)) {
          if (this.middleByHost.has(host)) {
            if (host.style.display !== "none") host.style.display = "none";
          } else {
            applyRows(rows, containers, false);
            const chip2 = this.chips.get(host);
            if (chip2 !== void 0 && chip2.style.display !== "none") chip2.style.display = "none";
            const hostDisplay = hasBodyText(host) ? "" : "none";
            if (host.style.display !== hostDisplay) host.style.display = hostDisplay;
          }
          continue;
        }
        if (host.style.display !== "") host.style.display = "";
        const expanded = this.expandedByHost.get(host) ?? false;
        if (!expanded && rows.some((row) => row.hasAttribute("data-selected"))) {
          this.expandedByHost.set(host, true);
        }
        const isExpanded = this.expandedByHost.get(host) ?? false;
        applyRows(rows, containers, isExpanded);
        const chip = this.ensureChip(host);
        if (chip.style.display !== "") chip.style.display = "";
        updateChip(chip, rows, isExpanded, this.trackElapsed(host, rows));
      }
      for (const [host, chip] of [...this.chips]) {
        if (!hosts.has(host) || !host.isConnected) {
          chip.remove();
          this.chips.delete(host);
          this.blockContainers.delete(host);
        }
      }
      for (const [, entry] of this.processedRows) {
        for (const host of entry.middleSteps) {
          if (!host.isConnected) continue;
          if (this.hiddenHosts.has(host)) {
            if (host.style.display !== "none") host.style.display = "none";
          } else if (host.style.display === "none") {
            host.style.display = "";
          }
        }
      }
      this.allRows = blocks.flatMap((b) => b.rows);
      replaceTurnStatus(this.turnStatusTexts);
    }
    /**
     * 回合收尾：回合边界（turn-tail / user）出现时，把边界之前、未被任何
     * "已处理" 行认领、且全部完成的块收进一个 "已处理" 行。
     *
     * - 最终输出消息（回合内最后一个 assistant-step + 正文）：只折叠它的
     *   think 行，正文保留可见；
     * - 中间正文消息（非最终 assistant-step）与上下文注入（kind=context）：
     *   整条折叠（过程正文隐藏，素材 Codex 对齐：收起态只留最终输出）；
     * - think 消息 / 工具卡：行折叠（现有逻辑）。
     *
     * 行插在回合第一个工作内容之前（用户消息之后、工作流程最上方），
     * 展开态与 Codex 素材一致：摘要行置顶，下方是完整工作流程。
     *
     * claimedHosts 保证每块只认领一次：用户展开/收起只动 hiddenHosts，已认领
     * 的块不会因后续新消息出现而被重复收起、也不会生成重复行。
     * 时长 = 本轮最早运行开始 → 本次收尾（历史回合从 turn-tail 解析）。
     */
    processTurn(blocks, boundary) {
      const scope = blocks.filter(
        (b) => !this.claimedHosts.has(b.host) && isAtOrBefore(b.host, boundary)
      );
      if (scope.some((b) => b.rows.some((r) => rowState(r) === "running"))) return false;
      if (scope.length === 0) return true;
      const steps = [];
      const contexts = [];
      let firstWork = null;
      const flow = boundary.parentElement;
      if (flow !== null) {
        const kidsArr = Array.from(flow.children).filter(
          (el) => el instanceof HTMLElement
        );
        const bIdx = kidsArr.indexOf(boundary);
        let turnStart = -1;
        for (let i = bIdx - 1; i >= 0; i--) {
          const kind = kidsArr[i].getAttribute("data-chat-flow-kind");
          if (kind === "user" || kind === "steering") {
            turnStart = i;
            break;
          }
        }
        for (let i = turnStart + 1; i < bIdx; i++) {
          const el = kidsArr[i];
          if (el.hasAttribute("data-chat-anchor-key") && !el.classList.contains("dshcf-processed")) {
            firstWork = el;
            break;
          }
        }
        for (const el of flow.children) {
          if (!(el instanceof HTMLElement)) continue;
          if (el === boundary) break;
          const kind = el.getAttribute("data-chat-flow-kind");
          if (kind === "assistant-step" && hasBodyText(el)) steps.push(el);
          else if (kind === "context") contexts.push(el);
        }
      }
      const finalStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const middleSteps = new Set(
        [...steps.slice(0, -1), ...contexts].filter((h) => !this.claimedHosts.has(h))
      );
      const duration = this.turnStartMs !== null ? Date.now() - this.turnStartMs : parseTurnDuration(boundary);
      this.turnStartMs = null;
      if (finalStep !== null) this.claimedHosts.add(finalStep);
      const hosts = new Set(scope.map((b) => b.host));
      for (const host of hosts) {
        this.claimedHosts.add(host);
        this.hiddenHosts.add(host);
      }
      for (const h of middleSteps) {
        this.claimedHosts.add(h);
        this.hiddenHosts.add(h);
      }
      const anchor = firstWork ?? finalStep ?? boundary;
      const entry = { hosts, middleSteps, duration, bodyNode: anchor };
      for (const h of middleSteps) this.middleByHost.set(h, entry);
      anchor.before(this.createProcessedRow(entry));
      return true;
    }
    /** 创建 "已处理" 行并绑定展开/收起。 */
    createProcessedRow(entry) {
      const row = createProcessedRowElement(entry.duration);
      row.addEventListener("click", () => {
        const all = [...entry.hosts, ...entry.middleSteps];
        const anyVisible = all.some((h) => h.isConnected && !this.hiddenHosts.has(h));
        if (anyVisible) {
          for (const h of all) this.hiddenHosts.add(h);
          row.setAttribute("aria-expanded", "false");
          row.title = "\u5C55\u5F00\u5DE5\u4F5C\u8FC7\u7A0B";
        } else {
          for (const h of all) {
            this.hiddenHosts.delete(h);
          }
          row.setAttribute("aria-expanded", "true");
          row.title = "\u6536\u8D77\u5DE5\u4F5C\u8FC7\u7A0B";
        }
        this.schedule();
      });
      this.processedRows.set(row, entry);
      return row;
    }
    /** 自愈：重建被 React 清掉的 "已处理" 行（原挂载点失效时按块位置找
     * 后面的正文节点，再不行挂到流末尾），并剔除已断开的块宿主。 */
    healProcessedRows(flow) {
      for (const [row, entry] of [...this.processedRows]) {
        if (row.isConnected) continue;
        this.processedRows.delete(row);
        for (const h of [...entry.hosts]) {
          if (!h.isConnected) entry.hosts.delete(h);
        }
        for (const h of [...entry.middleSteps]) {
          if (!h.isConnected) entry.middleSteps.delete(h);
          else this.middleByHost.set(h, entry);
        }
        if (entry.hosts.size === 0) continue;
        let target = entry.bodyNode.isConnected ? entry.bodyNode : findBodyAfter(flow, entry.hosts);
        if (target === null) target = flow;
        const rebuilt = this.createProcessedRow(entry);
        if (target === flow) target.prepend(rebuilt);
        else target.before(rebuilt);
      }
    }
    /**
     * 块级耗时追踪（Codex 完成态 "Worked for {duration}" 的对齐）：
     * - 行首次进入 running 时记录开始时间；
     * - 块内存在 running 行 → 视为新一轮运行，清除旧的固定时长；
     * - 块全部完成后固定耗时 = 当前时间 − 最早开始时间（只算 running 过的行；
     *   此后不再更新，除非块重新运行）。
     */
    trackElapsed(host, rows) {
      const now = Date.now();
      let anyRunning = false;
      for (const row of rows) {
        if (rowState(row) === "running") {
          anyRunning = true;
          if (!this.rowStarts.has(row)) this.rowStarts.set(row, now);
          if (this.turnStartMs === null) this.turnStartMs = now;
        }
      }
      if (anyRunning) {
        this.blockElapsed.delete(host);
        return void 0;
      }
      const starts = rows.map((row) => this.rowStarts.get(row)).filter((v) => v !== void 0);
      if (starts.length === 0 || this.blockElapsed.has(host)) {
        return this.blockElapsed.get(host);
      }
      const elapsed = now - Math.min(...starts);
      this.blockElapsed.set(host, elapsed);
      return elapsed;
    }
    /** 创建（或复用）宿主内部的折叠卡片。 */
    ensureChip(host) {
      const existing = this.chips.get(host);
      if (existing !== void 0 && existing.isConnected && existing.parentElement === host) {
        return existing;
      }
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dshcf-chip";
      chip.setAttribute("aria-expanded", "false");
      const leading = document.createElement("span");
      leading.className = "dshcf-leading";
      leading.appendChild(createTerminalIcon());
      chip.appendChild(leading);
      chip.appendChild(createSpan("dshcf-chip-title"));
      chip.appendChild(createSpan("dshcf-chip-sep"));
      chip.appendChild(createSpan("dshcf-chip-summary"));
      chip.appendChild(createSpan("dshcf-chevron"));
      chip.addEventListener("click", () => {
        const host2 = chip.parentElement;
        if (host2 === null) return;
        const next = !(this.expandedByHost.get(host2) ?? false);
        this.expandedByHost.set(host2, next);
        const containers = this.blockContainers.get(host2) ?? [];
        const rows = [
          ...rowsOf(host2),
          ...containers.flatMap((container) => rowsOf(container))
        ];
        applyRows(rows, containers, next);
        updateChip(chip, rows, next, this.blockElapsed.get(host2));
      });
      host.prepend(chip);
      this.chips.set(host, chip);
      return chip;
    }
  };
  function rowsOf(host) {
    const rows = [];
    const think = thinkRowsIn(host);
    const calls = callRowsIn(host);
    rows.push(...think, ...calls);
    return rows;
  }
  function createSpan(cls) {
    const span = document.createElement("span");
    span.className = cls;
    return span;
  }
  function createTerminalIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 10");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "10");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0.5");
    rect.setAttribute("y", "0.5");
    rect.setAttribute("width", "11");
    rect.setAttribute("height", "9");
    rect.setAttribute("rx", "1.5");
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "currentColor");
    const prompt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    prompt.setAttribute("x", "2");
    prompt.setAttribute("y", "7.5");
    prompt.setAttribute("font-size", "7");
    prompt.setAttribute("fill", "currentColor");
    prompt.textContent = ">_";
    svg.append(rect, prompt);
    return svg;
  }
  var THINK_ICON_PATHS = [
    {
      d: "M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z"
    },
    {
      evenodd: true,
      d: "M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z"
    }
  ];
  function findNativeThinkSvg() {
    for (const drow of document.querySelectorAll('[data-variant="think"] [data-disclosure-row]')) {
      for (const svg of drow.querySelectorAll("svg")) {
        if (svg.querySelectorAll("path").length >= 2) return svg;
      }
    }
    return null;
  }
  function createThinkIcon() {
    const native = findNativeThinkSvg();
    if (native !== null) return native.cloneNode(true);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "none");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    for (const p of THINK_ICON_PATHS) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (p.evenodd === true) {
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("clip-rule", "evenodd");
      }
      path.setAttribute("d", p.d);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    }
    return svg;
  }
  function findNativeCommandSvg() {
    let fallback = null;
    for (const drow of document.querySelectorAll("[data-chat-call-id] [data-disclosure-row]")) {
      for (const svg of drow.querySelectorAll("svg")) {
        if (svg.querySelectorAll("path").length < 2) continue;
        if (isIcon14(svg)) return svg;
        if (fallback === null) fallback = svg;
      }
    }
    return fallback;
  }
  function isIcon14(svg) {
    if (svg.getAttribute("width") === "14" && svg.getAttribute("height") === "14") return true;
    const vb = (svg.getAttribute("viewBox") ?? "").trim().split(/\s+/);
    return vb.length === 4 && Number(vb[2]) === 14 && Number(vb[3]) === 14;
  }
  function createCommandIcon() {
    const native = findNativeCommandSvg();
    if (native !== null) return native.cloneNode(true);
    return createTerminalIcon();
  }
  function syncLeadingIcon(chip, kind) {
    const leading = chip.querySelector(".dshcf-leading");
    if (leading === null) return;
    const existing = leading.querySelector("svg");
    if (existing !== null && existing.getAttribute("data-dshcf-icon") === kind) return;
    for (const child of [...leading.childNodes]) child.remove();
    const svg = kind === "think" ? createThinkIcon() : createCommandIcon();
    svg.setAttribute("data-dshcf-icon", kind);
    leading.appendChild(svg);
  }
  function findFlow() {
    const flows = document.querySelectorAll("[data-chat-flow]");
    for (const flow of flows) {
      if (flow.offsetParent !== null || flow.getBoundingClientRect().width > 0) return flow;
    }
    return flows[0] ?? null;
  }
  function findBlocks(flow) {
    const blocks = [];
    const children = [...flow.children].filter((el) => el instanceof HTMLElement);
    let run = null;
    for (const el of children) {
      if (el.getAttribute("data-chat-flow-kind") === "context") {
        run = null;
        continue;
      }
      const thinkRows = thinkRowsIn(el);
      const callRows = callRowsIn(el);
      const isToolPile = callRows.length > 0;
      const hasText = !isToolPile ? hasBodyText(el) : false;
      if (isToolPile || thinkRows.length > 0 && !hasText) {
        if (run === null) {
          run = { host: el, rows: [], containers: [] };
          blocks.push(run);
        }
        run.rows.push(...thinkRows, ...callRows);
        if (el !== run.host) {
          run.containers.push(el);
        }
      } else if (el.hasAttribute("data-chat-anchor-key") || hasText) {
        if (thinkRows.length > 0) {
          if (run === null) {
            run = { host: el, rows: [], containers: [] };
            blocks.push(run);
          }
          run.rows.push(...thinkRows);
        }
        run = null;
      }
    }
    return blocks;
  }
  function hasBodyText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      if (node.data.trim() === "") continue;
      const parent = node.parentElement;
      if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip') !== null) continue;
      return true;
    }
    return false;
  }
  function thinkRowsIn(el) {
    const rows = [];
    for (const row of el.querySelectorAll('[data-variant="think"]:not([data-tool])')) {
      if (row.closest("[data-chat-call-id]") !== null) continue;
      if (row.closest("[data-subcalls]") !== null) continue;
      rows.push(row);
    }
    return rows;
  }
  function callRowsIn(el) {
    const rows = [];
    for (const row of el.querySelectorAll("[data-chat-call-id]")) {
      if (row.closest("[data-subcalls]") !== null) continue;
      if (row.closest("[data-chat-call-id]") !== row) continue;
      rows.push(row);
    }
    return rows;
  }
  function applyRows(rows, containers, expanded) {
    const display = expanded ? "" : "none";
    for (const row of rows) {
      if (row.style.display !== display) row.style.display = display;
    }
    for (const container of containers) {
      if (container.style.display !== display) container.style.display = display;
    }
  }
  function deriveRowInfo(row) {
    const isThink = row.matches('[data-variant="think"]') && !row.hasAttribute("data-tool");
    if (isThink) {
      return { kind: "think", label: "Think", summary: thinkSummary(row), state: row.getAttribute("data-state") ?? "ok" };
    }
    const root = row.querySelector("[data-tool]") ?? row;
    const tool = root.getAttribute("data-tool") ?? "";
    const state = root.getAttribute("data-state") ?? "ok";
    const label = TOOL_LABELS[tool] ?? tool;
    return { kind: "tool", label: label !== "" ? label : "Tool", summary: toolSummary(row), state };
  }
  function thinkSummary(row) {
    const follow = row.querySelector("[data-follow-end]");
    if (follow !== null) {
      const text = (follow.textContent ?? "").trim();
      if (text !== "") return text;
    }
    return summaryFallback(row);
  }
  function toolSummary(row) {
    const drow = row.querySelector("[data-disclosure-row]");
    if (drow !== null && drow.lastElementChild !== null) {
      const text = (drow.lastElementChild.textContent ?? "").trim();
      if (text !== "") return text;
    }
    return summaryFallback(row);
  }
  function summaryFallback(row) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let best = "";
    let node;
    while ((node = walker.nextNode()) !== null) {
      if (node.parentElement?.closest('[data-open="true"]') !== null) continue;
      const text = node.data.trim();
      if (text === "") continue;
      if (text.length > best.length) best = text;
    }
    return best;
  }
  function deriveBlockInfo(rows) {
    const infos = rows.map(deriveRowInfo);
    const runningTool = infos.find((i) => i.kind === "tool" && i.state === "running") ?? null;
    const runningThink = infos.find((i) => i.kind === "think" && i.state === "running") ?? null;
    const tools = [...new Set(infos.filter((i) => i.kind === "tool").map((i) => i.label))];
    return {
      runningTool,
      runningThink,
      tools,
      count: rows.length,
      hasError: infos.some((i) => i.state === "error"),
      hasStopped: infos.some((i) => i.state === "stopped")
    };
  }
  function updateChip(chip, rows, expanded, elapsedMs) {
    const info = deriveBlockInfo(rows);
    const title = chip.querySelector(".dshcf-chip-title");
    const summary = chip.querySelector(".dshcf-chip-summary");
    const sep = chip.querySelector(".dshcf-chip-sep");
    if (title === null || summary === null) return;
    const running = info.runningTool ?? info.runningThink;
    let titleText;
    let summaryText;
    if (info.runningTool !== null) {
      titleText = "\u6B63\u5728\u8FD0\u884C";
      summaryText = info.runningTool.summary;
    } else if (info.runningThink !== null) {
      titleText = "\u6B63\u5728\u601D\u8003";
      summaryText = info.runningThink.summary;
    } else if (info.tools.length > 0) {
      titleText = "\u8FD0\u884C\u4E86\u547D\u4EE4";
      summaryText = "";
    } else {
      titleText = "\u5DF2\u601D\u8003";
      summaryText = "";
    }
    const kind = running !== null ? running.kind : info.tools.length > 0 ? "tool" : "think";
    if (title.textContent !== titleText) title.textContent = titleText;
    if (summary.textContent !== summaryText) summary.textContent = summaryText;
    if (sep !== null) {
      const sepDisplay = summaryText === "" ? "none" : "";
      if (sep.style.display !== sepDisplay) sep.style.display = sepDisplay;
    }
    const expandedAttr = String(expanded);
    if (chip.getAttribute("aria-expanded") !== expandedAttr) {
      chip.setAttribute("aria-expanded", expandedAttr);
    }
    if (chip.dataset.kind !== kind) {
      chip.dataset.kind = kind;
      syncLeadingIcon(chip, kind);
    }
    const tip = expanded ? "\u6536\u8D77\u8FD9\u4E9B\u5361\u7247" : "\u5C55\u5F00\u8FD9\u4E9B\u5361\u7247";
    if (chip.title !== tip) chip.title = tip;
    setClass(chip, "running", running !== null);
    setClass(chip, "error", !running && info.hasError);
    setClass(chip, "stopped", !running && info.hasStopped && !info.hasError);
  }
  function setClass(el, cls, on) {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }
  function takeNewAnchors(flow, seen) {
    const fresh = [];
    for (const el of flow.children) {
      if (!(el instanceof HTMLElement)) continue;
      if (!el.hasAttribute("data-chat-anchor-key")) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      fresh.push(el);
    }
    return fresh;
  }
  function isTurnEnd(anchor) {
    const kind = anchor.getAttribute("data-chat-flow-kind");
    return kind === "turn-tail" || kind === "user" || kind === "steering";
  }
  function parseTurnDuration(boundary) {
    const text = boundary.textContent ?? "";
    const m = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/);
    if (m === null) return void 0;
    if (m[1] !== void 0 && m[2] !== void 0) return Number(m[1]) * 6e4 + Number(m[2]) * 1e3;
    if (m[3] !== void 0) return Number(m[3]) * 1e3;
    if (m[1] !== void 0) return Number(m[1]) * 1e3;
    return void 0;
  }
  function isAtOrBefore(host, bodyNode) {
    const flow = bodyNode.parentElement;
    if (flow === null) return host === bodyNode;
    for (const el of flow.children) {
      if (el === host) return true;
      if (el === bodyNode) return false;
    }
    return host === bodyNode;
  }
  function rowState(row) {
    if (row.matches('[data-variant="think"]') && !row.hasAttribute("data-tool")) {
      return row.getAttribute("data-state") ?? "ok";
    }
    const root = row.querySelector("[data-tool]") ?? row;
    return root.getAttribute("data-state") ?? "ok";
  }
  function createProcessedRowElement(duration) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dshcf-processed";
    btn.setAttribute("aria-expanded", "false");
    const text = document.createElement("span");
    text.textContent = duration !== void 0 ? `\u5DF2\u5904\u7406 ${formatDuration(duration)}` : "\u5DF2\u5904\u7406";
    const chevron = document.createElement("span");
    chevron.className = "dshcf-processed-chevron";
    btn.append(text, chevron);
    btn.title = "\u5C55\u5F00\u5DE5\u4F5C\u8FC7\u7A0B";
    return btn;
  }
  function findBodyAfter(flow, hosts) {
    let afterAll = false;
    for (const el of flow.children) {
      if (!(el instanceof HTMLElement)) continue;
      if (hosts.has(el)) {
        afterAll = true;
        continue;
      }
      if (afterAll && el.hasAttribute("data-chat-anchor-key")) return el;
    }
    return null;
  }
  function formatDuration(ms) {
    const s = Math.round(ms / 1e3);
    if (s < 60) return `${s}\u79D2`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}\u5206${String(r).padStart(2, "0")}\u79D2`;
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CHIP_CSS;
    document.head.appendChild(style);
  }
  function replaceTurnStatus(originals) {
    for (const status of document.querySelectorAll('[role="status"]')) {
      for (const node of status.childNodes) {
        if (node instanceof Text && node.data.includes("Deep diving")) {
          if (!originals.has(node)) originals.set(node, node.data);
          node.data = node.data.replace("Deep diving", "Deep sleeping");
        }
      }
    }
  }
  function restoreTurnStatus(originals) {
    for (const [node, original] of originals) {
      if (node.isConnected && node.data.includes("Deep sleeping")) node.data = original;
    }
    originals.clear();
  }
  function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  // src/client.ts
  var name = "dsh-codex-fold";
  var inject = [];
  function apply(ctx) {
    ctx.effect(() => {
      const controller = new FoldController();
      controller.start();
      return () => controller.stop();
    }, "dsh-codex-fold: fold observer");
  }
  return __toCommonJS(client_exports);
})();
return __dshcfBundle;}});
