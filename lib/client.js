window.__ModuleLoader__.load({ id: "dsh-grounding-guard", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
if (typeof document !== "undefined") { const sheets = {"client.css":"/* src/grounding.module.css */\n.grounding_root {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  gap: 16px;\n  padding: 20px 24px;\n  overflow: auto;\n  color: var(--dsw-alias-label-primary, inherit);\n  background: var(--dsw-alias-bg-base, transparent);\n  font-family: var(--dsw-font-family, system-ui, -apple-system, sans-serif);\n}\n.grounding_header {\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  gap: 12px;\n  flex-wrap: wrap;\n}\n.grounding_title {\n  margin: 0;\n  font-size: 18px;\n  font-weight: 600;\n}\n.grounding_subtitle {\n  margin: 4px 0 0;\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #94a3b8);\n}\n.grounding_controls {\n  display: flex;\n  gap: 8px;\n  align-items: center;\n  flex-wrap: wrap;\n}\n.grounding_btn {\n  padding: 6px 12px;\n  border-radius: var(--dsw-radius-sm, 8px);\n  border: 1px solid var(--dsw-alias-border-l3, rgba(148, 163, 184, 0.3));\n  background: var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.1));\n  color: var(--dsw-alias-label-primary, inherit);\n  cursor: pointer;\n  font-size: 12px;\n}\n.grounding_btnActive {\n  border-color: #38bdf8;\n  background: rgba(56, 189, 248, 0.16);\n}\n.grounding_grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\n  gap: 12px;\n}\n.grounding_card {\n  border: 1px solid var(--dsw-alias-border-l3, rgba(148, 163, 184, 0.22));\n  border-radius: var(--dsw-radius-md, 10px);\n  padding: 14px 16px;\n  background: var(--dsw-alias-bg-layer-2, rgba(148, 163, 184, 0.06));\n}\n.grounding_cardLabel {\n  font-size: 11px;\n  text-transform: uppercase;\n  letter-spacing: 0.04em;\n  color: var(--dsw-alias-label-secondary, #94a3b8);\n}\n.grounding_cardValue {\n  margin-top: 6px;\n  font-size: 20px;\n  font-weight: 600;\n}\n.grounding_sectionTitle {\n  margin: 0 0 10px;\n  font-size: 14px;\n  font-weight: 600;\n}\n.grounding_list {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.grounding_row {\n  display: flex;\n  justify-content: space-between;\n  align-items: flex-start;\n  gap: 10px;\n  padding: 10px 12px;\n  border-radius: var(--dsw-radius-sm, 8px);\n  background: var(--dsw-alias-bg-layer-1, rgba(148, 163, 184, 0.05));\n  border: 1px solid var(--dsw-alias-border-l2, rgba(148, 163, 184, 0.15));\n  font-size: 12px;\n}\n.grounding_badge {\n  display: inline-block;\n  padding: 2px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 600;\n}\n.grounding_badgeVerified {\n  background: rgba(16, 185, 129, 0.2);\n  color: #34d399;\n}\n.grounding_badgePartial {\n  background: rgba(245, 158, 11, 0.2);\n  color: #fbbf24;\n}\n.grounding_badgeUnverified {\n  background: rgba(148, 163, 184, 0.2);\n  color: var(--dsw-alias-label-secondary, #cbd5e1);\n}\n.grounding_badgeContradicted {\n  background: rgba(239, 68, 68, 0.2);\n  color: #f87171;\n}\n.grounding_mono {\n  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);\n  font-size: 11px;\n  color: var(--dsw-alias-label-secondary, #94a3b8);\n}\n.grounding_empty {\n  font-size: 12px;\n  color: var(--dsw-alias-label-secondary, #94a3b8);\n  padding: 12px 0;\n}\n"}; for (const sheetPath of Object.keys(sheets)) { const tagId = "dsh-grounding-guard" + ":" + sheetPath; if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) { const tag = document.createElement("style"); tag.dataset.plugin = "dsh-grounding-guard"; tag.dataset.pluginCss = tagId; tag.textContent = sheets[sheetPath]; document.head.appendChild(tag); } } }
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/GroundingPanel.tsx
var import_react = require("react");

// src/grounding.module.css
var grounding_default = {
  root: "grounding_root",
  header: "grounding_header",
  title: "grounding_title",
  subtitle: "grounding_subtitle",
  controls: "grounding_controls",
  btn: "grounding_btn",
  btnActive: "grounding_btnActive",
  grid: "grounding_grid",
  card: "grounding_card",
  cardLabel: "grounding_cardLabel",
  cardValue: "grounding_cardValue",
  sectionTitle: "grounding_sectionTitle",
  list: "grounding_list",
  row: "grounding_row",
  badge: "grounding_badge",
  badgeVerified: "grounding_badgeVerified",
  badgePartial: "grounding_badgePartial",
  badgeUnverified: "grounding_badgeUnverified",
  badgeContradicted: "grounding_badgeContradicted",
  mono: "grounding_mono",
  empty: "grounding_empty"
};

// src/GroundingPanel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function verdictClass(verdict) {
  if (verdict === "verified") return grounding_default.badgeVerified ?? "";
  if (verdict === "partial") return grounding_default.badgePartial ?? "";
  if (verdict === "contradicted") return grounding_default.badgeContradicted ?? "";
  return grounding_default.badgeUnverified ?? "";
}
function GroundingPanel({
  rpc,
  t
}) {
  const [status, setStatus] = (0, import_react.useState)(null);
  const [verdicts, setVerdicts] = (0, import_react.useState)([]);
  const [evidence, setEvidence] = (0, import_react.useState)([]);
  const [error, setError] = (0, import_react.useState)(null);
  const refresh = (0, import_react.useCallback)(async () => {
    try {
      const [s, v, e] = await Promise.all([
        rpc.call("status"),
        rpc.call("listVerdicts"),
        rpc.call("listEvidence")
      ]);
      setStatus(s);
      setVerdicts(v.items ?? []);
      setEvidence(e.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rpc]);
  (0, import_react.useEffect)(() => {
    void refresh();
  }, [refresh]);
  const toggleNli = async () => {
    if (!status) return;
    await rpc.call("setNliEnabled", { enabled: !status.config.enableNliStage2 });
    await refresh();
  };
  const toggleMode = async () => {
    if (!status) return;
    await rpc.call("setMode", { mode: status.config.mode === "enforce" ? "observe" : "enforce" });
    await refresh();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.root, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.header, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: grounding_default.title, children: t("title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: grounding_default.subtitle, children: t("subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.controls, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: `${grounding_default.btn} ${status?.config.mode === "enforce" ? grounding_default.btnActive : ""}`, onClick: toggleMode, children: [
          t("action.mode"),
          ": ",
          status?.config.mode ?? "..."
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: `${grounding_default.btn} ${status?.config.enableNliStage2 ? grounding_default.btnActive : ""}`, onClick: toggleNli, children: [
          t("action.nli"),
          ": ",
          status?.config.enableNliStage2 ? "ON" : "OFF"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: grounding_default.btn, onClick: refresh, children: t("action.refresh") })
      ] })
    ] }),
    error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.row, children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.grid, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardLabel, children: t("metric.evidence") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardValue, children: status?.evidenceCount ?? 0 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardLabel, children: t("metric.verdicts") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardValue, children: status?.verdictCount ?? 0 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.card, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardLabel, children: t("metric.maxSteer") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.cardValue, children: status?.config.maxSteerCorrections ?? 1 })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: grounding_default.sectionTitle, children: t("section.verdicts") }),
      verdicts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.empty, children: t("empty.verdicts") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.list, children: verdicts.slice(0, 20).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${grounding_default.badge} ${verdictClass(item.verdict)}`, children: item.verdict }),
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: grounding_default.mono, children: item.turnKey }),
            item.steered ? " \xB7 steered" : "",
            item.nliUsed ? " \xB7 NLI" : " \xB7 Stage 1"
          ] }),
          item.issues.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.mono, children: item.issues.map((i) => `${i.code}: ${i.message}`).join(" | ") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: grounding_default.mono, children: item.createdAt })
      ] }, item.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: grounding_default.sectionTitle, children: t("section.evidence") }),
      evidence.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.empty, children: t("empty.evidence") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.list, children: evidence.slice(-20).reverse().map((ev) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: grounding_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: ev.id }),
            " \xB7 ",
            ev.locator,
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `${grounding_default.badge} ${ev.truncated ? grounding_default.badgePartial : grounding_default.badgeVerified}`, children: ev.truncated ? `truncated (next=${ev.nextOffset ?? "?"})` : ev.auditability })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: grounding_default.mono, children: ev.excerpt.slice(0, 140) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: grounding_default.mono, children: ev.sha256.slice(0, 12) })
      ] }, ev.id)) })
    ] })
  ] });
}

// src/client.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var NS = "dshGroundingGuard";
var PANEL_ID = "dsh-grounding-guard";
function GroundingIcon() {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("svg", { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "7.2", cy: "7.2", r: "4.8", stroke: "currentColor", strokeWidth: "1.4" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M5.2 7.4L6.6 8.8L9.6 5.8", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M10.8 10.8L13.8 13.8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" })
  ] });
}
var inject = ["slots", "locale", "layout", "connection"];
function apply(ctx) {
  ctx.effect(() => {
    const disposeZh = ctx.locale.register(NS, "zh", {
      nav: "\u8BC1\u636E\u62A4\u680F",
      title: "\u8BC1\u636E\u62A4\u680F\u4E0E\u53CD\u5E7B\u89C9\u6821\u9A8C\u53F0",
      subtitle: "Stage 1 \u786E\u5B9A\u6027\u5F15\u6587\u5B9A\u4F4D\u4E0E\u622A\u65AD\u65AD\u8A00\u5B88\u536B \xB7 answerBlocks \xB7 \u5199\u5165\u56DE\u6267\u6536\u655B \xB7 \u53EF\u9009 Stage 2 \u72EC\u7ACB NLI",
      "action.mode": "\u6A21\u5F0F",
      "action.nli": "Stage 2 NLI",
      "action.refresh": "\u5237\u65B0",
      "metric.evidence": "\u5DF2\u767B\u8BB0\u8BC1\u636E\u6761\u6570",
      "metric.verdicts": "\u5DF2\u6821\u9A8C\u56DE\u5408\u6570",
      "metric.maxSteer": "\u5355\u8F6E\u81EA\u7EA0\u4E0A\u9650",
      "section.verdicts": "\u56DE\u5408\u8BDA\u5B9E\u6821\u9A8C\u7ED3\u8BBA\uFF08\u6301\u4E45\u5316\uFF09",
      "section.evidence": "\u4F1A\u8BDD\u8BC1\u636E\u603B\u7EBF\u8BB0\u5F55",
      "empty.verdicts": "\u6682\u65E0\u6821\u9A8C\u8BB0\u5F55",
      "empty.evidence": "\u5F53\u524D\u4F1A\u8BDD\u5C1A\u672A\u6355\u83B7\u5DE5\u5177\u6216\u77E5\u8BC6\u5E93\u8BC1\u636E"
    });
    const disposeEn = ctx.locale.register(NS, "en", {
      nav: "Grounding",
      title: "Grounding & Evidence Verification Console",
      subtitle: "Stage 1 deterministic quote & truncation guard \xB7 answerBlocks \xB7 write receipts \xB7 optional Stage 2 NLI",
      "action.mode": "Mode",
      "action.nli": "Stage 2 NLI",
      "action.refresh": "Refresh",
      "metric.evidence": "Registered Evidence",
      "metric.verdicts": "Verified Turns",
      "metric.maxSteer": "Max Steer Retries",
      "section.verdicts": "Honest Turn Verdicts (Persisted)",
      "section.evidence": "Session Evidence Bus",
      "empty.verdicts": "No verified turns yet",
      "empty.evidence": "No tool or KB evidence captured yet"
    });
    return () => {
      disposeZh();
      disposeEn();
    };
  }, "dsh-grounding-guard: dictionaries");
  const t = ctx.locale.bind(NS);
  const rpc = {
    async call(method, payload) {
      const res = await ctx.connection.rpc.call("/api", "dshGroundingGuard", {
        method,
        payload: payload ?? {}
      });
      if (!res.ok) throw new Error(res.error?.message ?? `RPC failed: ${method}`);
      return res.value;
    }
  };
  ctx.slots.inject(
    "main",
    () => ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ rpc, t })
      },
      GroundingPanel
    )
  );
  ctx.slots.inject(
    "sidebar.panellist",
    () => ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 64,
        locale: NS,
        label: () => t("nav")
      },
      GroundingIcon
    )
  );
}

return module.exports; } });
