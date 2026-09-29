import z from "@deepseek-ai/schemastery";
const name = "dsh-auto-collapse";
const inject = [];
const DEFAULT_STATUS_TEXT = "Deep sleeping...";
const DEFAULT_SUMMARY_FIELDS = "duration,modelCalls(\u6B21\u6A21\u578B),toolCalls(\u6B21\u5DE5\u5177),inputTokens(\u8F93\u5165),cacheReadTokens(\u547D\u4E2D),cacheHitRate(\u547D\u4E2D\u7387),outputTokens(\u8F93\u51FA),contextDelta(\u4E0A\u4E0B\u6587)";
const DEFAULT_CODE_DESCRIPTION = "always";
const DEFAULT_KEEP_LAST_ROWS = 3;
const DEFAULT_KEEP_LAST_BODY_STEPS = 1;
const AUTO_COLLAPSE_SETTINGS_NAMESPACE = "dsh-auto-collapse";
function markVolatile(schema) {
  const candidate = schema;
  if (typeof candidate.volatile === "function") return candidate.volatile();
  if (typeof candidate.extra === "function") return candidate.extra("volatile", true);
  return schema;
}
const Config = z.object({
  statusText: markVolatile(z.string().default(DEFAULT_STATUS_TEXT)),
  summaryFields: markVolatile(z.string().default(DEFAULT_SUMMARY_FIELDS)),
  codeDescription: markVolatile(z.string().default(DEFAULT_CODE_DESCRIPTION)),
  keepLastRows: markVolatile(z.natural().default(DEFAULT_KEEP_LAST_ROWS)),
  keepLastBodySteps: markVolatile(z.natural().default(DEFAULT_KEEP_LAST_BODY_STEPS))
});
const VOLATILE_FIELDS = ["statusText", "summaryFields", "codeDescription", "keepLastRows", "keepLastBodySteps"];
withVolatileValidate(Config, VOLATILE_FIELDS);
function deref(value) {
  if (value !== null && typeof value === "object" && typeof value.get === "function") {
    try {
      return value.get();
    } catch {
      return void 0;
    }
  }
  return value;
}
const ROSTER_ROUTE = "/dsh-auto-collapse/roster";
const OWN_CLIENT_ID = "dsh-auto-collapse";
function rosterSignatureOf(ids) {
  return [...new Set(ids.map(String))].sort().join("\0");
}
function sanitizeConfig(value) {
  if (typeof value !== "object" || value === null) return null;
  const raw = value;
  const out = {};
  if (typeof raw.statusText === "string") out.statusText = raw.statusText;
  if (typeof raw.summaryFields === "string") out.summaryFields = raw.summaryFields;
  if (typeof raw.codeDescription === "string") out.codeDescription = raw.codeDescription;
  if (typeof raw.keepLastRows === "number" && Number.isFinite(raw.keepLastRows)) out.keepLastRows = Math.max(0, Math.floor(raw.keepLastRows));
  if (typeof raw.keepLastBodySteps === "number" && Number.isFinite(raw.keepLastBodySteps)) out.keepLastBodySteps = Math.max(0, Math.floor(raw.keepLastBodySteps));
  return Object.keys(out).length > 0 ? out : null;
}
function createRosterHandler(getModules, logger, getConfig) {
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
      let config = null;
      if (getConfig !== void 0) {
        try {
          config = sanitizeConfig(getConfig());
        } catch (error) {
          logger?.(error);
          config = null;
        }
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({
        sig: rosterSignatureOf(ids),
        own: ids.includes(OWN_CLIENT_ID),
        config
      }));
    } catch (error) {
      logger?.(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("internal error");
    }
  };
}
function installRosterRoute(ctx, getConfig) {
  ctx.inject(["webServer"], (webCtx) => {
    const handler = createRosterHandler(
      () => webCtx.get("clientModules"),
      (error) => webCtx.logger?.warn?.(error),
      getConfig
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
function readOwnSettings(settings, ns) {
  try {
    const descriptors = settings.describe();
    if (!Array.isArray(descriptors)) return null;
    for (const descriptor of descriptors) {
      if (descriptor === null || typeof descriptor !== "object") continue;
      if (descriptor.ns !== ns) continue;
      const value = descriptor.value;
      return typeof value === "object" && value !== null ? value : null;
    }
  } catch {
  }
  return null;
}
function installSettingsSection(ctx, ns, schema, entry, hooks, liveEntry = () => entry) {
  ctx.inject(["settings"], (settingsCtx) => {
    const settings = settingsCtx.settings;
    if (typeof settings.installSection !== "function" && typeof settings.describe === "function" && typeof settings.configure === "function") {
      settingsCtx.effect(() => {
        try {
          return settings.configure({ auto: false }, ctx.fiber);
        } catch (error) {
          settingsCtx.logger?.warn?.(error);
          return () => {
          };
        }
      });
      hooks.setSource(() => readOwnSettings(settings, ns) ?? liveEntry());
      hooks.onChange();
      return;
    }
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
      hooks.setSource(() => liveEntry());
      hooks.onChange();
    });
    hooks.onChange();
    scope.watch(() => {
      if (isUnloading(ctx)) return;
      hooks.onChange();
    });
  });
}
function createVolatileRef(value) {
  const write = Symbol.for("cosmokit.volatile.write");
  let current = freezeSnapshot(value);
  const ref = {
    get: () => current,
    [write]: (next) => {
      current = freezeSnapshot(next);
    }
  };
  return Object.freeze(ref);
}
function freezeSnapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value !== "object") return value;
  const object = value;
  if (ancestors.has(object)) return value;
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      for (const item of object) freezeSnapshot(item, ancestors);
    } else if (Object.getPrototypeOf(object) === Object.prototype || Object.getPrototypeOf(object) === null) {
      for (const item of Object.values(object)) freezeSnapshot(item, ancestors);
    }
    return Object.freeze(value);
  } finally {
    ancestors.delete(object);
  }
}
function isVolatileRef(value) {
  const write = Symbol.for("cosmokit.volatile.write");
  return typeof value === "object" && value !== null && write in value;
}
function withVolatileValidate(schema, fields) {
  const base = schema;
  const original = base["~standard"];
  if (original === void 0 || typeof original.validate !== "function") return;
  try {
    Object.defineProperty(schema, "~standard", {
      configurable: true,
      get() {
        return {
          version: original.version,
          vendor: original.vendor,
          validate(value) {
            const result = original.validate(value);
            if (result === void 0 || result.issues !== void 0 || result.value === void 0 || typeof result.value !== "object") return result;
            return { ...result, value: attachVolatileRefs(result.value, fields) };
          }
        };
      }
    });
  } catch (error) {
    ;
    schema.__dshcfVolatileWrapFailed = String(error);
  }
}
function attachVolatileRefs(value, fields) {
  const out = { ...value };
  for (const field of fields) {
    const current = out[field];
    if (current !== void 0 && current !== null && typeof current === "object" && typeof current.get === "function") continue;
    out[field] = createVolatileRef(current);
  }
  return out;
}
function apply(ctx, config = {}) {
  const volatileRef = (value) => {
    if (isVolatileRef(value)) return value;
    return createVolatileRef(value);
  };
  const refs = {
    statusText: volatileRef(config.statusText),
    summaryFields: volatileRef(config.summaryFields),
    codeDescription: volatileRef(config.codeDescription),
    keepLastRows: volatileRef(config.keepLastRows),
    keepLastBodySteps: volatileRef(config.keepLastBodySteps)
  };
  for (const key of Object.keys(refs)) {
    ;
    config[key] = refs[key];
  }
  const snapshot = () => ({
    statusText: refs.statusText.get() ?? DEFAULT_STATUS_TEXT,
    summaryFields: refs.summaryFields.get() ?? DEFAULT_SUMMARY_FIELDS,
    codeDescription: refs.codeDescription.get() ?? DEFAULT_CODE_DESCRIPTION,
    keepLastRows: refs.keepLastRows.get() ?? DEFAULT_KEEP_LAST_ROWS,
    keepLastBodySteps: refs.keepLastBodySteps.get() ?? DEFAULT_KEEP_LAST_BODY_STEPS
  });
  const cfg = snapshot();
  let current = snapshot;
  installSettingsSection(
    ctx,
    AUTO_COLLAPSE_SETTINGS_NAMESPACE,
    Config,
    {
      statusText: cfg.statusText ?? DEFAULT_STATUS_TEXT,
      summaryFields: cfg.summaryFields ?? DEFAULT_SUMMARY_FIELDS,
      codeDescription: cfg.codeDescription ?? DEFAULT_CODE_DESCRIPTION,
      keepLastRows: cfg.keepLastRows ?? DEFAULT_KEEP_LAST_ROWS,
      keepLastBodySteps: cfg.keepLastBodySteps ?? DEFAULT_KEEP_LAST_BODY_STEPS
    },
    {
      setSource: (source) => {
        current = source;
      },
      onChange: () => {
        void current;
      }
    },
    // 【2026-09-29】describe 不可用 / 命名空间未激活时的兜底：**现读引用**，
    // 不能用注册期的静态 cfg —— 那样在 volatile 热更新后会回退到旧值。
    snapshot
  );
  installRosterRoute(ctx, () => current());
}
export {
  Config,
  ROSTER_ROUTE,
  apply,
  createRosterHandler,
  inject,
  name,
  rosterSignatureOf
};
