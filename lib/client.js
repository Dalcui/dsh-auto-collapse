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
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 6px;
  background: var(--dsw-alias-bg-2, rgba(127, 127, 127, 0.07));
  color: var(--dsw-text-1, #333);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease;
}
.dshcf-chip:hover {
  background: var(--dsw-alias-bg-3, rgba(127, 127, 127, 0.13));
}

/* leading\uFF1A\u4E09\u4E2A\u5706\u70B9\u3002\u8FD0\u884C\u4E2D = \u9519\u5CF0\u8DF3\u52A8\uFF08Codex \u98CE\u683C\u7684\u8FDB\u884C\u6307\u793A\uFF09\uFF1B\u9759\u6B62 = \u8272\u5757\u3002 */
.dshcf-chip .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  width: 18px;
  height: 8px;
}
.dshcf-chip .dshcf-leading i {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.55));
}
.dshcf-chip:not(.running) .dshcf-leading i {
  width: 6px;
  height: 6px;
  border-radius: 2px;
}
.dshcf-chip.running .dshcf-leading i {
  animation: dshcf-bounce 1.2s ease-in-out infinite;
  background: var(--dsw-static-deepseek-500, #4d6bfe);
}
.dshcf-chip.running .dshcf-leading i:nth-child(2) { animation-delay: 0.15s; }
.dshcf-chip.running .dshcf-leading i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dshcf-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}

/* \u51FA\u9519\u7EA2 / \u4E2D\u65AD\u7425\u73C0\uFF08\u9759\u6B62\u6001\uFF09\u3002 */
.dshcf-chip.error:not(.running) .dshcf-leading i {
  background: var(--dsw-alias-state-error-primary, #e5484d);
}
.dshcf-chip.stopped:not(.running) .dshcf-leading i {
  background: var(--dsw-alias-state-warning-primary, #f5a524);
}

.dshcf-chip .dshcf-chip-title {
  flex: none;
  font-weight: 600;
}
.dshcf-chip .dshcf-chip-sep {
  flex: none;
  width: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-label-caption, rgba(127, 127, 127, 0.5));
}
.dshcf-chip .dshcf-chip-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, #666);
}

/* \u8FD0\u884C\u4E2D\uFF1A\u6807\u9898 + \u6458\u8981\u8D70 Deep diving \u6D41\u5149\uFF08\u5B98\u65B9 turnStatus shimmer \u914D\u65B9\uFF09\u3002 */
.dshcf-chip.running .dshcf-chip-title,
.dshcf-chip.running .dshcf-chip-summary {
  background: linear-gradient(
    90deg,
    var(--dsw-static-deepseek-500, #4d6bfe) 0%,
    var(--dsw-static-deepseek-500, #4d6bfe) 40%,
    var(--dsw-static-deepseek-200, #9db2ff) 50%,
    var(--dsw-static-deepseek-500, #4d6bfe) 60%,
    var(--dsw-static-deepseek-500, #4d6bfe) 100%
  );
  background-size: 250% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: dshcf-shimmer 1.8s linear infinite;
}
@keyframes dshcf-shimmer {
  to { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dshcf-chip.running .dshcf-leading i { animation: none; }
  .dshcf-chip.running .dshcf-chip-title,
  .dshcf-chip.running .dshcf-chip-summary {
    animation: none;
    background-position: 0 0;
    background-size: 100% 100%;
  }
}
`;
  var FoldController = class {
    constructor() {
      this.observer = null;
      this.raf = 0;
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
      this.observer?.disconnect();
      applyRows(this.allRows, [...this.blockContainers.values()].flat(), true);
      for (const chip of this.chips.values()) chip.remove();
      this.chips.clear();
      removeStyle();
    }
    schedule() {
      if (this.disposed || this.raf !== 0) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.pass();
      });
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
      for (const block of blocks) {
        const { host, rows, containers } = block;
        hosts.add(host);
        const expanded = this.expandedByHost.get(host) ?? false;
        if (!expanded && rows.some((row) => row.hasAttribute("data-selected"))) {
          this.expandedByHost.set(host, true);
        }
        const isExpanded = this.expandedByHost.get(host) ?? false;
        applyRows(rows, containers, isExpanded);
        const chip = this.ensureChip(host);
        updateChip(chip, rows, isExpanded);
      }
      for (const [host, chip] of [...this.chips]) {
        if (!hosts.has(host) || !host.isConnected) {
          chip.remove();
          this.chips.delete(host);
        }
      }
      this.allRows = blocks.flatMap((b) => b.rows);
      replaceTurnStatus();
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
      leading.appendChild(document.createElement("i"));
      leading.appendChild(document.createElement("i"));
      leading.appendChild(document.createElement("i"));
      chip.appendChild(leading);
      chip.appendChild(createSpan("dshcf-chip-title"));
      chip.appendChild(createSpan("dshcf-chip-sep"));
      chip.appendChild(createSpan("dshcf-chip-summary"));
      chip.addEventListener("click", () => {
        const host2 = chip.parentElement;
        if (host2 === null) return;
        const next = !(this.expandedByHost.get(host2) ?? false);
        this.expandedByHost.set(host2, next);
        applyRows(rowsOf(host2), this.blockContainers.get(host2) ?? [], next);
        updateChip(chip, rowsOf(host2), next);
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
      const thinkRows = thinkRowsIn(el);
      const callRows = callRowsIn(el);
      const isToolPile = callRows.length > 0;
      const hasText = !isToolPile && thinkRows.length > 0 ? hasBodyText(el) : false;
      if (isToolPile || thinkRows.length > 0 && !hasText) {
        if (run === null) {
          run = { host: el, rows: [], containers: [] };
          blocks.push(run);
        }
        run.rows.push(...thinkRows, ...callRows);
        if (isToolPile && el !== run.host) {
          run.containers.push(el);
        }
      } else if (el.hasAttribute("data-chat-anchor-key")) {
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
    for (const row of rows) {
      row.style.display = expanded ? "" : "none";
    }
    for (const container of containers) {
      container.style.display = expanded ? "" : "none";
    }
  }
  function deriveRowInfo(row) {
    const state = row.getAttribute("data-state") ?? "ok";
    const isThink = row.matches('[data-variant="think"]') && !row.hasAttribute("data-tool");
    if (isThink) {
      return { kind: "think", label: "Think", summary: thinkSummary(row), state };
    }
    const tool = row.getAttribute("data-tool") ?? "";
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
  function updateChip(chip, rows, expanded) {
    const info = deriveBlockInfo(rows);
    const title = chip.querySelector(".dshcf-chip-title");
    const summary = chip.querySelector(".dshcf-chip-summary");
    if (title === null || summary === null) return;
    const running = info.runningTool ?? info.runningThink;
    let titleText;
    let summaryText;
    if (info.runningTool !== null) {
      titleText = `Running ${info.runningTool.label}`;
      summaryText = info.runningTool.summary;
    } else if (info.runningThink !== null) {
      titleText = "Thinking";
      summaryText = info.runningThink.summary;
    } else if (info.tools.length > 0) {
      titleText = info.tools.join(" \xB7 ");
      summaryText = `(${info.count})`;
    } else {
      titleText = "Think";
      summaryText = `(${info.count})`;
    }
    if (expanded) summaryText = summaryText === "" ? "\u6536\u8D77" : `${summaryText} \xB7 \u6536\u8D77`;
    title.textContent = titleText;
    summary.textContent = summaryText;
    chip.setAttribute("aria-expanded", String(expanded));
    chip.title = expanded ? "\u6536\u8D77\u8FD9\u4E9B\u5361\u7247" : "\u5C55\u5F00\u8FD9\u4E9B\u5361\u7247";
    chip.classList.toggle("running", running !== null);
    chip.classList.toggle("error", !running && info.hasError);
    chip.classList.toggle("stopped", !running && info.hasStopped && !info.hasError);
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CHIP_CSS;
    document.head.appendChild(style);
  }
  function replaceTurnStatus() {
    for (const status of document.querySelectorAll('[role="status"]')) {
      for (const node of status.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.data.includes("Deep diving")) {
          node.data = node.data.replace("Deep diving", "Deep sleeping");
        }
      }
    }
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
