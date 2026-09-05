import z from "@deepseek-ai/schemastery";
const name = "dsh-auto-collapse";
const inject = [];
const DEFAULT_STATUS_TEXT = "Deep sleeping...";
const DEFAULT_SUMMARY_FIELDS = "duration,modelCalls(\u6B21\u6A21\u578B),toolCalls(\u6B21\u5DE5\u5177),inputTokens(\u8F93\u5165),cacheReadTokens(\u547D\u4E2D),cacheHitRate(\u547D\u4E2D\u7387),outputTokens(\u8F93\u51FA),contextDelta(\u4E0A\u4E0B\u6587)";
const DEFAULT_CODE_DESCRIPTION = "always";
const DEFAULT_KEEP_LAST_ROWS = 3;
const DEFAULT_KEEP_LAST_BODY_STEPS = 1;
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = "dsh-auto-collapse";
const AUTO_COLLAPSE_SETTINGS_SCHEMA = z.object({
  statusText: z.string().default(DEFAULT_STATUS_TEXT),
  summaryFields: z.string().default(DEFAULT_SUMMARY_FIELDS),
  codeDescription: z.string().default(DEFAULT_CODE_DESCRIPTION),
  keepLastRows: z.natural().default(DEFAULT_KEEP_LAST_ROWS),
  keepLastBodySteps: z.natural().default(DEFAULT_KEEP_LAST_BODY_STEPS)
});
const ROSTER_ROUTE = "/dsh-auto-collapse/roster";
const OWN_CLIENT_ID = "dsh-auto-collapse";
function rosterSignatureOf(ids) {
  return [...new Set(ids.map(String))].sort().join("\0");
}
function createRosterHandler(getModules, logger) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end();
      return;
    }
    try {
      const entries = getModules()?.graph?.()?.entries ?? [];
      const ids = [];
      for (const entry of entries) {
        if (typeof entry.id === "string" && entry.id !== "") ids.push(entry.id);
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({
        sig: rosterSignatureOf(ids),
        own: ids.includes(OWN_CLIENT_ID)
      }));
    } catch (error) {
      logger?.(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("internal error");
    }
  };
}
function installRosterRoute(ctx) {
  ctx.inject(["webServer"], (webCtx) => {
    const handler = createRosterHandler(
      () => webCtx.get("clientModules"),
      (error) => webCtx.logger?.warn?.(error)
    );
    const dispose = webCtx.webServer.register({ kind: "exact", path: ROSTER_ROUTE, handler });
    return () => {
      dispose();
    };
  });
}
const FIBER_DISPOSED = 4;
const FIBER_UNLOADING = 5;
function isUnloading(context) {
  const state = context?.fiber?.state;
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
function installSettingsSection(ctx, ns, schema, entry, hooks) {
  ctx.inject(["settings"], (settingsCtx) => {
    const settings = settingsCtx.settings;
    if (typeof settings.installSection === "function") {
      settings.installSection(ctx, ns, schema, entry, hooks);
      return;
    }
    const scope = settings.register(ns, schema, {
      base: entry,
      ...hooks.validate === void 0 ? {} : { validate: hooks.validate }
    });
    hooks.setSource(() => scope.get());
    settingsCtx.effect(() => () => {
      if (isUnloading(ctx)) return;
      hooks.setSource(() => entry);
      hooks.onChange();
    });
    hooks.onChange();
    scope.watch(() => {
      if (isUnloading(ctx)) return;
      hooks.onChange();
    });
  });
}
function apply(ctx, config = {}) {
  let current = () => ({
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: config.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: config.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS
  });
  installSettingsSection(ctx, AUTO_COLLAPSE_SETTINGS_NAMESPACE, AUTO_COLLAPSE_SETTINGS_SCHEMA, {
    statusText: config.statusText ?? DEFAULT_STATUS_TEXT,
    summaryFields: config.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: config.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: config.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: config.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS
  }, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {
      void current;
    }
  });
  installRosterRoute(ctx);
}
export {
  apply,
  createRosterHandler,
  inject,
  name,
  rosterSignatureOf
};
