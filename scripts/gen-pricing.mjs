#!/usr/bin/env node
// gen-pricing.mjs — single source of truth for VIDEO prices on x402video.com.
//
// Reads the LIVE gateway and rewrites every video-price fragment across the static
// site (home + subpages) so display can never drift from what the gateway charges.
// Idempotent: re-running with the same catalog produces a zero diff. Fails loudly
// if any expected anchor is missing (a hand-edit removed a hook).
//
// Usage:
//   node scripts/gen-pricing.mjs            # fetch live, rewrite files
//   node scripts/gen-pricing.mjs --check    # dry-run: exit 1 if any file would change (CI gate)
//   SOURCE=https://api.x402video.com/ node scripts/gen-pricing.mjs
//
// Sources: GET / (fixed-SKU prices) + GET /openapi.json (parametric custom min/max).
// When the gateway ships GET /catalog.v1.json, fold both into that one read.
// Image SKUs ($0.05/$0.10) are intentionally NOT managed here: they are unlisted
// upstream and absent from the storefront. They stay hand-maintained until listed.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.SOURCE || "https://api.x402video.com/").replace(/\/+$/, "");
const CHECK = process.argv.includes("--check");
const DASH = "–"; // en-dash used in "$0.26–$3.42"

const usd = (n) => Number(n).toFixed(2); // "3.04"
const perSec = (n) => Number(Number(n).toFixed(4)).toString(); // 0.608 -> "0.608", 0.48 -> "0.48"

async function getJson(path, timeout = 15000) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${BASE}${path} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchCatalog() {
  const store = await getJson("/");
  const skus = store.skus || store.fixed_skus;
  if (!Array.isArray(skus)) throw new Error("storefront has no skus[] array");
  const fixed = (id) => {
    const s = skus.find((x) => x.sku === id);
    if (!s) throw new Error(`SKU "${id}" not in live storefront (got: ${skus.map((x) => x.sku).join(", ")})`);
    const price = Number(s.price_usd);
    const dur = Number(s.duration_seconds) || 5;
    if (!Number.isFinite(price) || price <= 0) throw new Error(`SKU ${id} bad price_usd=${s.price_usd}`);
    return { price, dur, perSec: price / dur };
  };
  const std = fixed("seedance-5s-720p");
  const fast = fixed("seedance-fast-5s-720p");

  // Parametric ranges: authoritative min/max straight from the gateway's openapi.
  const api = await getJson("/openapi.json");
  const dyn = (route) => {
    const op = api.paths?.[route]?.post;
    const p = op?.["x-payment-info"]?.price;
    if (!p || p.mode !== "dynamic" || p.min == null || p.max == null) {
      throw new Error(`openapi ${route} has no dynamic min/max`);
    }
    return { min: Number(p.min), max: Number(p.max) };
  };
  const stdCustom = dyn("/generate/seedance/custom");
  const fastCustom = dyn("/generate/seedance-fast/custom");

  return { std, fast, min: Math.min(std.price, fast.price), max: Math.max(std.price, fast.price), stdCustom, fastCustom };
}

// One replacement rule. `find` must match BOTH the original literal and any prior
// generated value (\d+\.\d+ inside a stable anchor) so the script is idempotent.
const rule = (label, find, replace, expectMin = 1) => ({ label, find, replace, expectMin });
const range = (lo, hi) => `$${usd(lo)}${DASH}$${usd(hi)}`;

function homeRules(c) {
  const foot = (price, ps) =>
    `<div class="model-foot"><div><span class="model-price">$${perSec(ps)}</span>` +
    `<span class="model-per">/ sec</span><span class="model-call">$${usd(price)} · 5s 720p per call</span>` +
    `</div><a class="try-btn" href="#buy">↗ Try it</a></div>`;
  return [
    rule("card-std", /(<!-- x402-pricing:start card-std -->)[\s\S]*?(<!-- x402-pricing:end card-std -->)/, (_m, a, b) => a + foot(c.std.price, c.std.perSec) + b),
    rule("card-fast", /(<!-- x402-pricing:start card-fast -->)[\s\S]*?(<!-- x402-pricing:end card-fast -->)/, (_m, a, b) => a + foot(c.fast.price, c.fast.perSec) + b),
    rule("jsonld-low", /("lowPrice": )\d+(?:\.\d+)?/, (_m, a) => a + usd(c.min)),
    rule("jsonld-high", /("highPrice": )\d+(?:\.\d+)?/, (_m, a) => a + usd(c.max)),
    rule("badge-en", /(from \$)\d+(?:\.\d+)?(\/call · USDC on Base · no signup)/g, (_m, a, b) => a + usd(c.min) + b, 2),
    rule("badge-zh", /(每次 \$)\d+(?:\.\d+)?( 起 · Base)/, (_m, a, b) => a + usd(c.min) + b),
    rule("hero-endpoint", /(generate\/seedance-fast\/5s-720p<\/code> · \$)\d+(?:\.\d+)?(\/call)/, (_m, a, b) => a + usd(c.fast.price) + b),
    rule("onboard-en", /(A 5-second video costs about \$)\d+(?:\.\d+)?/g, (_m, a) => a + usd(c.std.price), 2),
    rule("onboard-zh", /(一支 5 秒影片約 \$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.std.price)),
    rule("trace-amount", /(amount: \$)\d+(?:\.\d+)?/g, (_m, a) => a + usd(c.std.price), 2),
    rule("trace-total", /(total cost \$)\d+(?:\.\d+)?/g, (_m, a) => a + usd(c.std.price), 2),
    rule("fallback-std", /(sku: "seedance-5s-720p"[^}]*price_usd: )\d+(?:\.\d+)?/, (_m, a) => a + usd(c.std.price)),
    rule("fallback-fast", /(sku: "seedance-fast-5s-720p"[^}]*price_usd: )\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fast.price)),
  ];
}

// Fixed/custom price tokens that follow a uniquely-identifying endpoint or JSON-LD
// "name". The lazy [\s\S]{0,N}? bridges name→price within ONE object only.
function seedanceRules(c) {
  return [
    rule("meta-from", /(From \$)\d+(?:\.\d+)?(\/call)/g, (_m, a, b) => a + usd(c.min) + b, 2),
    rule("badge-from", /(live · from \$)\d+(?:\.\d+)?(\/call)/, (_m, a, b) => a + usd(c.min) + b),
    rule("ld-fast-fixed", /("name": "Seedance 2\.0 Fast · 5s 720p"[\s\S]{0,90}?"price": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fast.price)),
    rule("ld-std-fixed", /("name": "Seedance 2\.0 · 5s 720p"[\s\S]{0,90}?"price": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.std.price)),
    rule("ld-fast-clow", /("name": "Seedance 2\.0 Fast · Custom"[\s\S]{0,90}?"lowPrice": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fastCustom.min)),
    rule("ld-fast-chigh", /("name": "Seedance 2\.0 Fast · Custom"[\s\S]{0,150}?"highPrice": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fastCustom.max)),
    rule("ld-std-clow", /("name": "Seedance 2\.0 · Custom"[\s\S]{0,90}?"lowPrice": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.stdCustom.min)),
    rule("ld-std-chigh", /("name": "Seedance 2\.0 · Custom"[\s\S]{0,150}?"highPrice": ")\d+(?:\.\d+)?/, (_m, a) => a + usd(c.stdCustom.max)),
    rule("tbl-fast-fixed", /(seedance-fast\/5s-720p<\/code><\/td>[\s\S]{0,120}?<span class="price">~\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fast.price)),
    rule("tbl-std-fixed", /(generate\/seedance\/5s-720p<\/code><\/td>[\s\S]{0,120}?<span class="price">~\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.std.price)),
    rule("tbl-fast-custom", /(seedance-fast\/custom<\/code><\/td>[\s\S]{0,120}?<span class="price">\$)\d+(?:\.\d+)?–\$\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fastCustom.min) + DASH + "$" + usd(c.fastCustom.max)),
    rule("tbl-std-custom", /(generate\/seedance\/custom<\/code><\/td>[\s\S]{0,120}?<span class="price">\$)\d+(?:\.\d+)?–\$\d+(?:\.\d+)?/, (_m, a) => a + usd(c.stdCustom.min) + DASH + "$" + usd(c.stdCustom.max)),
  ];
}

function useCasesRules(c) {
  const uc = (ep) => `uc-endpoint">POST \\/generate\\/${ep}<\\/span>\\s*<span class="uc-price">`;
  return [
    rule("meta-from-lc", /(from \$)\d+(?:\.\d+)?(\/call)/g, (_m, a, b) => a + usd(c.min) + b, 1),
    rule("meta-from-uc", /(From \$)\d+(?:\.\d+)?(\/call)/g, (_m, a, b) => a + usd(c.min) + b, 1),
    rule("ld-clip-range", /(at \$)\d+(?:\.\d+)?–\$\d+(?:\.\d+)?(\/clip)/, (_m, a, b) => a + usd(c.min) + DASH + "$" + usd(c.max) + b),
    rule("uc-fast-fixed", new RegExp("(" + uc("seedance-fast/5s-720p") + "~\\$)\\d+(?:\\.\\d+)?", "g"), (_m, a) => a + usd(c.fast.price), 3),
    rule("uc-std-fixed", new RegExp("(" + uc("seedance/5s-720p") + "~\\$)\\d+(?:\\.\\d+)?"), (_m, a) => a + usd(c.std.price)),
    rule("uc-fast-custom", new RegExp("(" + uc("seedance-fast/custom") + "\\$)\\d+(?:\\.\\d+)?–\\$\\d+(?:\\.\\d+)?"), (_m, a) => a + usd(c.fastCustom.min) + DASH + "$" + usd(c.fastCustom.max)),
    rule("uc-std-custom", new RegExp("(" + uc("seedance/custom") + "\\$)\\d+(?:\\.\\d+)?–\\$\\d+(?:\\.\\d+)?"), (_m, a) => a + usd(c.stdCustom.min) + DASH + "$" + usd(c.stdCustom.max)),
  ];
}

function whatIsRules(c) {
  return [
    rule("prose-start", /(starting around \$)\d+(?:\.\d+)?( per 5-second)/g, (_m, a, b) => a + usd(c.min) + b, 2),
    rule("prose-span", /(starts around <span class="price">\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.min)),
    rule("tbl-fast", /(Seedance 2\.0 Fast · 5s 720p video<\/td>[\s\S]{0,150}?<span class="price">~\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.fast.price)),
    rule("tbl-std", /(Seedance 2\.0 · 5s 720p video<\/td>[\s\S]{0,150}?<span class="price">~\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.std.price)),
  ];
}

function compareRules(c) {
  return [
    rule("clip-around", /(clip starts around \$)\d+(?:\.\d+)?( — so you)/g, (_m, a, b) => a + usd(c.min) + b, 2),
    rule("single-clip", /(buy a single clip \(~\$)\d+(?:\.\d+)?/, (_m, a) => a + usd(c.min)),
  ];
}

function klingRules(c) {
  // The Kling page's comparison row cites OUR live "from" price (seedance), not Kling.
  return [rule("avail-from", /(Live now — from \$)\d+(?:\.\d+)?(\/call)/, (_m, a, b) => a + usd(c.min) + b)];
}

const FILES = {
  "index.html": homeRules,
  "seedance/index.html": seedanceRules,
  "use-cases/index.html": useCasesRules,
  "what-is-x402/index.html": whatIsRules,
  "compare/index.html": compareRules,
  "kling/index.html": klingRules,
};

async function applyRules(relPath, rules) {
  const path = join(ROOT, relPath);
  const before = await readFile(path, "utf8");
  let out = before;
  for (const r of rules) {
    let n = 0;
    out = out.replace(r.find, (...args) => {
      n++;
      return r.replace(...args);
    });
    if (n < r.expectMin) {
      throw new Error(`[${relPath}] rule "${r.label}" matched ${n}x, expected >= ${r.expectMin}. A price anchor was removed or edited.`);
    }
  }
  const changed = out !== before;
  if (changed && !CHECK) await writeFile(path, out, "utf8");
  return changed;
}

(async () => {
  const c = await fetchCatalog();
  console.log(
    `live: std $${usd(c.std.price)} ($${perSec(c.std.perSec)}/s) · fast $${usd(c.fast.price)} ($${perSec(c.fast.perSec)}/s) · from $${usd(c.min)}` +
      ` · custom std ${range(c.stdCustom.min, c.stdCustom.max)} fast ${range(c.fastCustom.min, c.fastCustom.max)}`,
  );
  let anyChanged = false;
  for (const [file, build] of Object.entries(FILES)) {
    const changed = await applyRules(file, build(c));
    anyChanged = anyChanged || changed;
    console.log(`${changed ? (CHECK ? "WOULD CHANGE" : "updated") : "unchanged"}  ${file}`);
  }
  if (CHECK && anyChanged) {
    console.error("\n--check: a price fragment is stale vs the live gateway. Run `node scripts/gen-pricing.mjs` and commit.");
    process.exit(1);
  }
  console.log(anyChanged ? "done." : "all prices already match live.");
})().catch((e) => {
  console.error("gen-pricing FAILED:", e.message);
  process.exit(1);
});
