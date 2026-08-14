window.__ModuleLoader__.load({id:"dsh-auto-collapse",factory:function(require){
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
.dshcf-chip[aria-expanded="true"],
.dshcf-chip.dshcf-has-body {
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
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
/* running \u6458\u8981\uFF1A\u8DDF\u968F\u6EDA\u52A8\u663E\u793A\u6700\u65B0\u5185\u5BB9\uFF08text-overflow: clip\uFF0C\u539F\u751F\u540C\u6B3E\uFF09\u3002 */
.dshcf-chip.running .dshcf-chip-summary {
  text-overflow: clip;
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

/* "\u5DF2\u5904\u7406"\u884C\uFF1A\u6700\u7EC8\u8F93\u51FA\u51FA\u73B0\u540E\u5DE5\u4F5C\u8FC7\u7A0B\u6574\u4F53\u9690\u85CF\uFF0C\u53EA\u7559\u8FD9\u4E00\u884C + \u65F6\u957F\u3002
   \u5B57\u4F53\u4E0E\u4E8C\u7EA7 chip \u5BF9\u9F50\uFF0814px/24px\uFF09\uFF0C\u5DE6\u53F3\u65E0\u5185\u8FB9\u8DDD\uFF08\u4E0E\u6B63\u6587\u5DE6\u7F18\u5BF9\u9F50\uFF09\u3002 */
.dshcf-processed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: none;
  background: none;
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  /* \u5BF9\u9F50 DSH \u539F\u751F\u5DE5\u5177\u884C\u6458\u8981\u7684\u6B21\u7EA7\u5C42\u7EA7\uFF08label-tertiary\uFF09\u3002 */
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  user-select: none;
  border-radius: 4px;
}
.dshcf-processed:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-3, rgba(127, 127, 127, 0.13));
  /* hover \u80CC\u666F\u4ECE\u6B63\u6587\u5DE6\u7F18\u5F00\u59CB\uFF1A\u8D1F margin \u5411\u5DE6\u6269 4px\uFF0Cpadding \u53F3\u63A8 4px
     \u628A\u6587\u672C\u9876\u56DE\u539F\u4F4D\uFF08\u5BBD\u5EA6\u4E0D\u53D8\uFF0C\u65E0\u5E03\u5C40\u4F4D\u79FB\uFF09\u3002 */
  margin: 0 -4px;
  padding: 2px 4px;
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

/* \u4E09\u7EA7\u884C\u8FC7\u591A\u65F6\uFF1A\u5C55\u5F00\u6001\u5BBF\u4E3B\u53D8\u6EDA\u52A8\u5BB9\u5668\uFF08\u7EAF CSS\uFF0C\u4E0D\u52A8 React \u8282\u70B9\uFF09\u3002
   max-height \u2248 7 \u4E2A\u6298\u53E0\u4E09\u7EA7\u884C + \u4F59\u91CF\uFF1Bchip sticky \u5438\u9876\u4E0D\u968F\u5185\u5BB9\u6EDA\u8D70\u3002
   \u4EC5\u7528\u4E8E\u7EAF\u5806\u79EF\u5757\uFF08\u6B63\u6587\u6D88\u606F\u5BBF\u4E3B\u4E0D\u6EDA\u52A8\uFF0C\u6B63\u6587\u5FC5\u987B\u5B8C\u6574\u5C55\u793A\uFF09\u3002 */
.dshcf-chip-scroll {
  max-height: 240px;
  overflow-y: auto;
}
.dshcf-chip-scroll > .dshcf-chip {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--dsw-alias-bg-base, #161616);
}

/* \u4E09\u7EA7\u5408\u5E76\u601D\u8003\u884C\uFF1A\u5C55\u5F00\u4E8C\u7EA7\u540E\u8FDE\u7EED\u601D\u8003\u5408\u5E76\u4E3A\u4E00\u884C\uFF08\u6807\u9898 = \u7B2C\u4E00\u884C\u601D\u8003\u5185\u5BB9\uFF09\u3002
   \u6837\u5F0F\u4E0E chip \u540C\u65CF\uFF0816px \u56FE\u6807\u76D2\u300114px/24px\u3001\u539F\u751F label token \u8272\uFF09\u3002 */
.dshcf-merged-think {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: 400 14px/24px system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.dshcf-merged-think .dshcf-leading {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}
.dshcf-merged-think .dshcf-leading svg {
  display: block;
  color: var(--dsw-alias-label-tertiary);
}
.dshcf-merged-think .dshcf-merged-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 85%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-weight: 400;
}
.dshcf-merged-think .dshcf-chevron {
  flex: none;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  opacity: 0.55;
  color: var(--dsw-alias-label-secondary);
  transition: transform 0.2s ease;
}
.dshcf-merged-think[aria-expanded="true"] .dshcf-chevron {
  transform: rotate(45deg);
}
/* \u5408\u5E76\u601D\u8003\u5185\u5BB9\u5757\uFF1A\u56DB\u4E2A\u601D\u8003\u5408\u5E76\u4E3A\u4E00\u4E2A\u6574\u4F53\uFF08\u5BF9\u9F50\u56FE\u6807\u53F3\u4FA7\u7F29\u8FDB\uFF09\u3002 */
.dshcf-merged-body {
  margin: 0 0 16px;
  padding-left: 22px;
  color: var(--dsw-alias-label-secondary);
  font: 400 13px/22px system-ui, -apple-system, "Segoe UI", sans-serif;
  white-space: pre-wrap;
  word-break: break-word;
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
      /** chip → 它管理的行/容器（click 时从块绑定取，避免多 chip 同 host 时
       * 把正文后的行也卷进来）。 */
      this.chipBlocks = /* @__PURE__ */ new WeakMap();
      /** chip → 状态 key（anchor ?? host），展开状态/容器/耗时按块独立。 */
      this.chipKeys = /* @__PURE__ */ new WeakMap();
      /** host → 三级合并思考行（展开二级后连续思考合并显示为一个三级行）。 */
      this.mergedThinks = /* @__PURE__ */ new Map();
      /** 合并思考行的展开状态（true = 显示合并内容块）。 */
      this.mergedExpanded = /* @__PURE__ */ new WeakSet();
      /** 合并内容缓存（首次从原生行读取后保存，pass 重建内容块时不再重新展开原生行）。 */
      this.mergedBodyTexts = /* @__PURE__ */ new WeakMap();
      /** 合并行标题缓存（原生行展开态提取不到摘要时保持首次标题，不丢成“思考”）。 */
      this.mergedTitles = /* @__PURE__ */ new WeakMap();
      /** host 元素 → 展开状态（按流容器元素隔离，切换会话不串状态）。 */
      this.expandedByHost = /* @__PURE__ */ new WeakMap();
      /** 最近一轮 pass 见过的全部行（stop 时统一还原）。 */
      this.allRows = [];
      /** host → 该块需要随折叠的容器（工具组元素）。 */
      this.blockContainers = /* @__PURE__ */ new Map();
      /** 已见过的正文消息元素：新正文（模型最终输出）出现时收起工作过程。 */
      this.seenBodyNodes = /* @__PURE__ */ new WeakSet();
      /** 已出现但尚有 running 行的回合边界；状态变更后继续尝试收尾。 */
      this.pendingBoundaries = /* @__PURE__ */ new Set();
      /** 已整体隐藏的块宿主（工作过程收进 "已处理" 行）。
       * WeakSet 快速判定 + Set 可遍历（宿主分类漂移时恢复可见）。 */
      this.hiddenHosts = /* @__PURE__ */ new WeakSet();
      this.hiddenHostList = /* @__PURE__ */ new Set();
      /** 上一轮 pass 作为容器隐藏的元素（分类漂移恢复用：脱离块结构后需还原）。 */
      this.lastContainers = /* @__PURE__ */ new Set();
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
        attributeFilter: ["data-selected", "data-state"],
        // 流式文本更新（React 改 text node 的 data）属于 characterData
        // mutation：不观察则二级摘要/滚动跟随只能靠偶发结构变化驱动，
        // 变成“隔几秒跳一次”。所有文本写入都有守卫（值不变不写），
        // 不会自激。
        characterData: true
      });
      this.schedule();
    }
    stop() {
      this.disposed = true;
      if (this.raf !== 0) cancelAnimationFrame(this.raf);
      if (this.timer !== 0) clearTimeout(this.timer);
      this.observer?.disconnect();
      for (const row of this.mergedThinks.values()) row.remove();
      this.mergedThinks.clear();
      applyRows(this.allRows, [...this.blockContainers.values()].flat(), true);
      for (const host of this.middleByHost.keys()) host.style.display = "";
      for (const [, entry] of this.processedRows) {
        for (const h of entry.hosts) h.style.display = "";
      }
      this.middleByHost.clear();
      for (const [host, chip] of this.chips) {
        host.style.display = "";
        host.classList.remove("dshcf-chip-scroll");
        chip.remove();
      }
      this.chips.clear();
      for (const row of this.processedRows.keys()) row.remove();
      this.processedRows.clear();
      this.pendingBoundaries.clear();
      this.hiddenHostList.clear();
      this.lastContainers.clear();
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
        if (isTurnEnd(anchor) && !isFirstUser(anchor)) this.pendingBoundaries.add(anchor);
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
          this.removeMergedThink(host);
          if (this.middleByHost.has(host)) {
            if (host.style.display !== "none") host.style.display = "none";
          } else {
            applyRows(rows, containers, false);
            const chip2 = this.chips.get(host);
            if (chip2 !== void 0 && chip2.style.display !== "none") chip2.style.display = "none";
            const foldsSelf = rows.includes(host);
            const hostDisplay = !foldsSelf && hasBodyText(host) ? "" : "none";
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
        if (isExpanded && rows.length > 1 && rows.every((r) => isThinkRow(r))) {
          this.syncMergedThink(host, rows);
        } else {
          this.removeMergedThink(host);
        }
        const chip = this.ensureChip(host);
        this.chipBlocks.set(chip, { rows, containers });
        this.chipKeys.set(chip, host);
        chip.classList.toggle("dshcf-has-body", hasBodyText(host));
        const hostHasBody = chip.classList.contains("dshcf-has-body");
        host.classList.toggle("dshcf-chip-scroll", isExpanded && !hostHasBody);
        if (chip.style.display !== "") chip.style.display = "";
        updateChip(chip, rows, isExpanded);
        this.trackTurnStart(rows);
      }
      for (const [host, chip] of [...this.chips]) {
        if (!hosts.has(host) || !host.isConnected) {
          chip.remove();
          this.chips.delete(host);
          this.blockContainers.delete(host);
          const merged = this.mergedThinks.get(host);
          if (merged !== void 0) {
            merged.remove();
            this.mergedThinks.delete(host);
          }
        }
      }
      for (const [node] of [...this.turnStatusTexts]) {
        if (!node.isConnected) this.turnStatusTexts.delete(node);
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
      const covered = /* @__PURE__ */ new Set();
      for (const b of blocks) {
        for (const r of b.rows) covered.add(r);
        for (const c of b.containers) covered.add(c);
      }
      for (const h of [...this.hiddenHostList, ...this.lastContainers]) {
        if (!h.isConnected) {
          this.hiddenHostList.delete(h);
          this.lastContainers.delete(h);
          continue;
        }
        if (!covered.has(h) && !this.middleByHost.has(h) && hasBodyText(h)) {
          if (h.style.display === "none") h.style.display = "";
        }
      }
      this.lastContainers.clear();
      for (const b of blocks) {
        for (const c of b.containers) this.lastContainers.add(c);
      }
      replaceTurnStatus(this.turnStatusTexts);
    }
    /**
     * 回合收尾：回合边界（turn-tail / user）出现时，把边界之前、未被任何
     * "已处理" 行认领、且全部完成的块收进一个 "已处理" 行。
     *
     * - 最终输出消息（回合内最后一个带正文的 assistant / assistant-step）：
     *   只折叠它的 think 行，正文保留可见；
     * - 中间正文消息（非最终 assistant-step）：整条折叠（过程正文隐藏，
     *   素材 Codex 对齐：收起态只留最终输出）；上下文注入（kind=context）
     *   现在是二级块（chip "上下文注入"），随本回合 scope 收进一级行。
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
        for (let i = turnStart + 1; i < bIdx; i++) {
          const el = kidsArr[i];
          const kind = el.getAttribute("data-chat-flow-kind");
          if ((kind === "assistant-step" || kind === "assistant") && hasBodyText(el)) steps.push(el);
        }
      }
      const finalStep = steps.length > 0 ? steps[steps.length - 1] : null;
      const middleSteps = new Set(steps.slice(0, -1).filter((h) => !this.claimedHosts.has(h)));
      const duration = this.turnStartMs !== null ? Date.now() - this.turnStartMs : parseTurnDuration(boundary);
      this.turnStartMs = null;
      if (finalStep !== null) this.claimedHosts.add(finalStep);
      const hosts = new Set(scope.map((b) => b.host));
      for (const host of hosts) {
        this.claimedHosts.add(host);
        this.hiddenHosts.add(host);
        this.hiddenHostList.add(host);
      }
      for (const h of middleSteps) {
        this.claimedHosts.add(h);
        this.hiddenHosts.add(h);
        this.hiddenHostList.add(h);
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
          for (const h of all) this.hiddenHostList.add(h);
          row.setAttribute("aria-expanded", "false");
          row.title = "\u5C55\u5F00\u5DE5\u4F5C\u8FC7\u7A0B";
        } else {
          for (const h of all) {
            this.hiddenHosts.delete(h);
            this.hiddenHostList.delete(h);
          }
          this.collapseAllChips();
          row.setAttribute("aria-expanded", "true");
          row.title = "\u6536\u8D77\u5DE5\u4F5C\u8FC7\u7A0B";
        }
        this.schedule();
      });
      this.processedRows.set(row, entry);
      return row;
    }
    /** 连续思考合并行：插在第一个思考行前，标题用第一行思考内容；
     * 点击切换显示/隐藏全部原始思考行。 */
    syncMergedThink(host, rows) {
      let row = this.mergedThinks.get(host);
      if (row === void 0 || !row.isConnected) {
        row = document.createElement("button");
        row.type = "button";
        row.className = "dshcf-merged-think";
        row.setAttribute("aria-expanded", "false");
        const leading = document.createElement("span");
        leading.className = "dshcf-leading";
        leading.appendChild(createThinkIcon());
        const title = document.createElement("span");
        title.className = "dshcf-merged-title";
        const chevron = document.createElement("span");
        chevron.className = "dshcf-chevron";
        row.append(leading, title, chevron);
        const btn = row;
        btn.addEventListener("click", () => {
          const next = !this.mergedExpanded.has(host);
          if (next) this.mergedExpanded.add(host);
          else this.mergedExpanded.delete(host);
          btn.setAttribute("aria-expanded", String(next));
          if (next) this.expandMergedBody(host, btn);
          else this.collapseMergedBody(host);
        });
        rows[0].before(row);
        this.mergedThinks.set(host, row);
        row = btn;
      }
      const titleEl = row.querySelector(".dshcf-merged-title");
      if (titleEl !== null) {
        let title = this.mergedTitles.get(host);
        if (title === void 0) {
          const first = truncateSummary(stripMarkdown(thinkSummary(rows[0])), 36);
          if (first !== "" && first !== "\u601D\u8003") {
            title = `Think \xB7 ${first}`;
            this.mergedTitles.set(host, title);
          } else {
            title = "\u601D\u8003";
          }
        }
        if (titleEl.textContent !== title) titleEl.textContent = title;
      }
      const expanded = this.mergedExpanded.has(host);
      if (row.getAttribute("aria-expanded") !== String(expanded)) row.setAttribute("aria-expanded", String(expanded));
      if (row.style.display !== "") row.style.display = "";
      for (const r of rows) {
        if (r.style.display !== "none") r.style.display = "none";
      }
      if (expanded) this.ensureMergedBody(host, row, false);
    }
    /** 展开合并行：直接读各思考行文本合成内容块（不依赖原生行展开：
     * 程序化 click 不触发 React 展开，且后台 tab 的 rAF 不执行）。 */
    expandMergedBody(host, btn) {
      const cached = this.mergedBodyTexts.get(host);
      if (cached !== void 0) {
        this.ensureMergedBody(host, btn, true);
        return;
      }
      const parts = this.currentThinkRows(host).map((r) => r.textContent.replace(/^Think\s*/, "").trim()).filter(Boolean);
      if (parts.length === 0) return;
      this.mergedBodyTexts.set(host, parts.join("\n\n"));
      this.ensureMergedBody(host, btn, true);
    }
    /** 创建/更新合并内容块（缓存优先，不重新展开原生行）。 */
    ensureMergedBody(host, btn, force) {
      const cached = this.mergedBodyTexts.get(host);
      if (cached === void 0) return;
      let body = btn.nextElementSibling;
      if (body === null || !body.classList.contains("dshcf-merged-body")) {
        body = document.createElement("div");
        body.className = "dshcf-merged-body";
        btn.after(body);
      }
      if (force || body.textContent !== cached) body.textContent = cached;
    }
    /** 收起合并行：移除内容块（原生行保持隐藏）。 */
    collapseMergedBody(host) {
      const btn = this.mergedThinks.get(host);
      if (btn !== void 0) {
        const body = btn.nextElementSibling;
        if (body !== null && body.classList.contains("dshcf-merged-body")) body.remove();
      }
    }
    /** 当前宿主内的思考行（现取，React 重渲染后引用仍然有效）。 */
    currentThinkRows(host) {
      return [...host.querySelectorAll('[data-variant="think"]:not([data-tool])')].filter(
        (r) => r.closest("[data-chat-call-id]") === null && r.closest("[data-subcalls]") === null
      );
    }
    /** 移除合并思考行（二级收起 / 一级收起时），恢复行由 applyRows 控制。
     * 合并内容块（btn 的兄弟节点）一并移除，避免宿主展开后残留文本。 */
    removeMergedThink(host) {
      const row = this.mergedThinks.get(host);
      if (row !== void 0) {
        const body = row.nextElementSibling;
        if (body !== null && body.classList.contains("dshcf-merged-body")) body.remove();
        row.remove();
        this.mergedThinks.delete(host);
      }
      this.mergedExpanded.delete(host);
      this.mergedBodyTexts.delete(host);
    }
    /** 一级展开后的重置：所有二级 chip 收起（行隐藏、状态清零、文案刷新）。 */
    collapseAllChips() {
      for (const chip of this.chips.values()) {
        const k = this.chipKeys.get(chip);
        if (k === void 0) continue;
        this.expandedByHost.delete(k);
        const { rows, containers } = this.chipBlocks.get(chip) ?? { rows: [], containers: [] };
        applyRows(rows, containers, false);
        if (chip.getAttribute("aria-expanded") !== "false") chip.setAttribute("aria-expanded", "false");
        chip.title = "\u5C55\u5F00\u8FD9\u4E9B\u5361\u7247";
        updateChip(chip, rows, false);
      }
      for (const host of [...this.mergedThinks.keys()]) {
        this.removeMergedThink(host);
      }
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
        if (entry.hosts.size === 0 && entry.middleSteps.size === 0) continue;
        let target = entry.bodyNode.isConnected ? entry.bodyNode : findBodyAfter(flow, entry.hosts);
        if (target === null) {
          const alive = [...entry.middleSteps].find((h) => h.isConnected);
          target = alive ?? null;
        }
        if (target === null) target = flow;
        const rebuilt = this.createProcessedRow(entry);
        if (target === flow) target.prepend(rebuilt);
        else target.before(rebuilt);
      }
    }
    /**
     * 回合级耗时起点：本轮最早开始运行的行。只维护 turnStartMs（一级
     * "已处理"时长用）。块级耗时已删除（updateChip 不使用，属死链路）。
     */
    trackTurnStart(rows) {
      if (this.turnStartMs !== null) return;
      for (const row of rows) {
        if (rowState(row) === "running") {
          this.turnStartMs = Date.now();
          return;
        }
      }
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
        const parent = chip.parentElement;
        if (parent === null) return;
        const k = this.chipKeys.get(chip) ?? parent;
        const next = !(this.expandedByHost.get(k) ?? false);
        this.expandedByHost.set(k, next);
        const { rows, containers } = this.chipBlocks.get(chip) ?? { rows: [], containers: [] };
        applyRows(rows, containers, next);
        if (next && rows.length > 1 && rows.every((r) => isThinkRow(r))) {
          this.syncMergedThink(parent, rows);
        } else {
          this.removeMergedThink(parent);
        }
        updateChip(chip, rows, next);
      });
      host.prepend(chip);
      this.chips.set(host, chip);
      return chip;
    }
  };
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
  var COMMAND_ICON_PATHS = [
    {
      transform: "translate(0.6689 1.073)",
      d: "M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.13965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769898C11.6637 0.879302 11.7834 0.998981 11.8928 1.12708C12.3131 1.61928 12.4942 2.21169 12.5798 2.91638C12.6638 3.60747 12.6627 4.48273 12.6627 5.57813L12.6627 6.2771Z"
    },
    {
      transform: "translate(0.6689 1.073)",
      d: "M6.02607 5.50955L6.44306 5.9274L3.84284 8.52762L3.425 8.11063L3.00715 7.69278L4.77253 5.9274L3.00715 4.16202L3.84284 3.32633L6.02607 5.50955Z"
    },
    {
      transform: "translate(0.6689 1.073)",
      d: "M9.23789 7.35397L9.23789 8.53488L6.96238 8.53488L6.96238 7.35397L9.23789 7.35397Z"
    }
  ];
  function createCommandIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("fill", "none");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    for (const p of COMMAND_ICON_PATHS) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("transform", p.transform);
      path.setAttribute("d", p.d);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    }
    return svg;
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
    let carry = [];
    let carryHost = null;
    for (const el of children) {
      const thinkRows = thinkRowsIn(el);
      const callRows = callRowsIn(el);
      const isToolPile = callRows.length > 0;
      const isContext = el.getAttribute("data-chat-flow-kind") === "context";
      const hasText = !isToolPile ? hasBodyText(el) : false;
      if (isToolPile || isContext || thinkRows.length > 0 && !hasText) {
        if (run === null) {
          run = { host: el, rows: [], containers: [] };
          blocks.push(run);
        }
        if (carry.length > 0) {
          run.rows.push(...carry);
          carry = [];
        }
        run.rows.push(...thinkRows, ...callRows);
        if (isContext) run.rows.push(el);
        if (el !== run.host && !isContext) {
          run.containers.push(el);
        }
      } else if (el.hasAttribute("data-chat-anchor-key") && (thinkRows.length > 0 || hasText) || hasText && el.getAttribute("data-chat-flow-kind") !== null) {
        if (thinkRows.length > 0) {
          const segments = splitThinkByBody(el, thinkRows);
          if (run === null) {
            run = { host: el, rows: [], containers: [] };
            blocks.push(run);
          }
          run.rows.push(...segments[0]);
          carry = segments.slice(1).flat();
          carryHost = el;
        }
        run = null;
      }
    }
    if (carry.length > 0 && carryHost !== null) {
      const own = blocks.find((b) => b.host === carryHost);
      if (own !== void 0) own.rows.push(...carry);
      else if (blocks.length > 0) blocks[blocks.length - 1].rows.push(...carry);
    }
    return blocks;
  }
  function splitThinkByBody(el, rows) {
    const segments = [];
    let current = [];
    for (let i = 0; i < rows.length; i++) {
      current.push(rows[i]);
      if (i + 1 < rows.length && hasBodyBetween(el, rows[i], rows[i + 1])) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length > 0) segments.push(current);
    return segments.length > 0 ? segments : [rows];
  }
  function hasBodyBetween(el, a, b) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      if (node.data.trim() === "") continue;
      const parent = node.parentElement;
      if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body') !== null) continue;
      const posA = a.compareDocumentPosition(node);
      const posB = b.compareDocumentPosition(node);
      if ((posA & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && (posB & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
        return true;
      }
    }
    return false;
  }
  function hasBodyText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) !== null) {
      if (node.data.trim() === "") continue;
      const parent = node.parentElement;
      if (parent !== null && parent.closest('[data-variant="think"], [data-chat-call-id], .dshcf-chip, .dshcf-merged-think, .dshcf-merged-body') !== null) continue;
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
    if (row.getAttribute("data-chat-flow-kind") === "context") {
      return { kind: "tool", label: "\u4E0A\u4E0B\u6587\u6CE8\u5165", summary: toolSummary(row), state: "ok" };
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
      hasStopped: infos.some((i) => i.state === "stopped"),
      allContext: infos.length > 0 && infos.every((i) => i.label === "\u4E0A\u4E0B\u6587\u6CE8\u5165")
    };
  }
  function updateChip(chip, rows, expanded) {
    const info = deriveBlockInfo(rows);
    const title = chip.querySelector(".dshcf-chip-title");
    const summary = chip.querySelector(".dshcf-chip-summary");
    const sep = chip.querySelector(".dshcf-chip-sep");
    if (title === null || summary === null) return;
    const running = info.runningTool ?? info.runningThink;
    const collapsed = !expanded;
    let titleText;
    let summaryText;
    if (info.runningTool !== null) {
      titleText = "\u6B63\u5728\u8FD0\u884C";
      summaryText = collapsed ? info.runningTool.summary : "";
    } else if (info.runningThink !== null) {
      titleText = "\u6B63\u5728\u601D\u8003";
      summaryText = collapsed ? info.runningThink.summary : "";
    } else if (info.tools.length > 0) {
      titleText = info.allContext ? "\u4E0A\u4E0B\u6587\u6CE8\u5165" : "\u8FD0\u884C\u4E86\u547D\u4EE4";
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
    summary.scrollLeft = running !== null ? summary.scrollWidth - summary.clientWidth : 0;
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
  function truncateSummary(text, max) {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "\u2026" : t;
  }
  function stripMarkdown(text) {
    return text.replace(/\*\*/g, "").replace(/^#{1,3}\s+/, "").trim();
  }
  function isThinkRow(row) {
    return row.matches('[data-variant="think"]') && !row.hasAttribute("data-tool");
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
  function isFirstUser(anchor) {
    const kind = anchor.getAttribute("data-chat-flow-kind");
    if (kind !== "user" && kind !== "steering") return false;
    const flow = anchor.parentElement;
    if (flow === null) return false;
    for (const el of flow.children) {
      if (el === anchor) return true;
      const k = el.getAttribute("data-chat-flow-kind");
      if (k === "user" || k === "steering") return false;
    }
    return false;
  }
  function isTurnEnd(anchor) {
    const kind = anchor.getAttribute("data-chat-flow-kind");
    return kind === "turn-tail" || kind === "user" || kind === "steering";
  }
  function parseTurnDuration(boundary) {
    const text = boundary.textContent ?? "";
    const m = text.match(/用时\s*(\d+)分(\d+)秒|用时\s*(\d+)秒/);
    if (m !== null) {
      if (m[1] !== void 0 && m[2] !== void 0) return Number(m[1]) * 6e4 + Number(m[2]) * 1e3;
      if (m[3] !== void 0) return Number(m[3]) * 1e3;
      return void 0;
    }
    const end = parseTimeText(text);
    const start = findTurnStart(boundary);
    if (end !== void 0 && start !== void 0 && end > start) return end - start;
    return void 0;
  }
  function parseTimeText(text) {
    const m = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
    if (m === null) return void 0;
    const year = m[1] !== void 0 ? Number(m[1]) : (/* @__PURE__ */ new Date()).getFullYear();
    const t = new Date(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
    return Number.isNaN(t) ? void 0 : t;
  }
  function findTurnStart(boundary) {
    const flow = boundary.parentElement;
    if (flow === null) return void 0;
    let best = null;
    for (const s of flow.querySelectorAll('[class*="timeStart"]')) {
      const pos = s.compareDocumentPosition(boundary);
      if ((pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 || (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0 || s === boundary) best = s;
      else break;
    }
    if (best === null) return void 0;
    return parseTimeText(best.textContent ?? "");
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
    const h = Math.floor(s / 3600);
    const m = Math.floor(s % 3600 / 60);
    const r = s % 60;
    if (h > 0) {
      return m > 0 ? `${h}\u5C0F\u65F6${m}\u5206` : `${h}\u5C0F\u65F6`;
    }
    if (r === 0) return `${m}\u5206`;
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
          const next = node.data.replace("Deep diving", "Deep sleeping");
          if (node.data !== next) node.data = next;
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
  var name = "dsh-auto-collapse";
  var inject = [];
  function apply(ctx) {
    ctx.effect(() => {
      const controller = new FoldController();
      controller.start();
      return () => controller.stop();
    }, "dsh-auto-collapse: fold observer");
  }
  return __toCommonJS(client_exports);
})();
return __dshcfBundle;}});
