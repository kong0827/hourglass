#!/usr/bin/env node
/**
 * scan-style-drift.mjs
 *
 * Finds style values that bypass design tokens:
 *   - hardcoded colors (hex / rgb / rgba / hsl)
 *   - hardcoded font-size px values
 *   - hardcoded border-radius px values
 *   - inline style attributes in HTML
 *   - token reference count (var(--...))
 *
 * Usage:
 *   node scan-style-drift.mjs <dir> [--tokens <file>] [--limit 12] [--json]
 *
 * Notes:
 *   - Files whose basename matches /token/i are treated as token definitions
 *     and excluded unless --tokens points elsewhere.
 *   - Output is intentionally short and LLM-friendly.
 */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (!args.length || args[0] === "-h" || args[0] === "--help") {
  console.log("Usage: node scan-style-drift.mjs <dir> [--tokens <file>] [--limit 12] [--json]");
  process.exit(args.length ? 0 : 1);
}

const root = path.resolve(args[0]);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Not a directory: ${root}`);
  process.exit(1);
}

function getOption(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const limit = Math.max(1, Number(getOption("--limit", "12")) || 12);
const tokenArg = getOption("--tokens", null);
const jsonMode = args.includes("--json");
const tokenPath = tokenArg ? path.resolve(root, tokenArg) : null;

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", "out",
  "vendor", "vendors", "third_party", "third-party", "libs",
]);
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const RGB_RE = /\b(?:rgb|rgba|hsl|hsla)\([^)]*\)/g;
const VAR_RE = /var\(\s*--[a-zA-Z0-9-_]+/g;
const FONT_RE = /font-size\s*:\s*([^;{}]+)/gi;
const RADIUS_RE = /border-radius\s*:\s*([^;{}]+)/gi;
const INLINE_STYLE_RE = /\bstyle\s*=\s*"([^"]*)"/gi;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(css|html?)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function isTokenFile(file) {
  if (tokenPath) return path.resolve(file) === tokenPath;
  return /token/i.test(path.basename(file));
}

function normalizeHex(hex) {
  let h = hex.toLowerCase();
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (h.length === 5) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}${h[4]}${h[4]}`;
  return h;
}

function normalizeValue(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function bump(map, key, file) {
  const item = map.get(key) || { count: 0, files: new Set() };
  item.count += 1;
  item.files.add(path.relative(root, file));
  map.set(key, item);
}

const files = walk(root);
const tokenFiles = [];
const colors = new Map();
const fontSizes = new Map();
const radii = new Map();
const inlineStyles = new Map();
let varRefs = 0;
let cssFiles = 0;
let htmlFiles = 0;

for (const file of files) {
  const rel = path.relative(root, file);
  if (isTokenFile(file)) {
    tokenFiles.push(rel);
    continue;
  }
  const isCss = file.toLowerCase().endsWith(".css");
  if (isCss) cssFiles += 1;
  else htmlFiles += 1;

  let text = fs.readFileSync(file, "utf8");
  if (isCss) text = stripComments(text);

  varRefs += (text.match(VAR_RE) || []).length;

  for (const raw of text.match(HEX_RE) || []) bump(colors, normalizeHex(raw), file);
  for (const raw of text.match(RGB_RE) || []) bump(colors, normalizeValue(raw), file);

  if (isCss) {
    for (const match of text.matchAll(FONT_RE)) {
      const value = normalizeValue(match[1]);
      if (/^[\d.]+px$/.test(value)) bump(fontSizes, value, file);
    }
    for (const match of text.matchAll(RADIUS_RE)) {
      const value = normalizeValue(match[1]);
      if (!value.includes("var(") && !value.includes("calc(") && /(?:^|\s)[\d.]+px(?:\s|$)/.test(value)) {
        bump(radii, value, file);
      }
    }
  } else {
    for (const match of text.matchAll(INLINE_STYLE_RE)) {
      const value = match[1].trim();
      if (!value) continue;
      const key = value.length > 80 ? `${value.slice(0, 77)}...` : value;
      bump(inlineStyles, normalizeValue(key), file);
    }
  }
}

function rank(map) {
  return [...map.entries()]
    .map(([value, meta]) => ({
      value,
      count: meta.count,
      files: [...meta.files].sort(),
      spread: meta.files.size,
    }))
    .sort((a, b) => b.count - a.count || b.spread - a.spread || a.value.localeCompare(b.value));
}

function total(map) {
  let n = 0;
  for (const meta of map.values()) n += meta.count;
  return n;
}

const colorRank = rank(colors);
const fontRank = rank(fontSizes);
const radiusRank = rank(radii);
const inlineRank = rank(inlineStyles);

const report = {
  root,
  files: { css: cssFiles, html: htmlFiles, tokenFiles },
  colors: { occurrences: total(colors), distinct: colors.size, top: colorRank.slice(0, limit) },
  fontSizes: { occurrences: total(fontSizes), distinct: fontSizes.size, top: fontRank.slice(0, limit) },
  radii: { occurrences: total(radii), distinct: radii.size, top: radiusRank.slice(0, limit) },
  inlineStyles: { occurrences: total(inlineStyles), distinct: inlineStyles.size, top: inlineRank.slice(0, limit) },
  varRefs,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

function lines(title, data) {
  console.log(`\n${title}: ${data.occurrences} occurrences, ${data.distinct} distinct`);
  if (!data.top.length) {
    console.log("  (none)");
    return;
  }
  for (const item of data.top) {
    const where = item.files.slice(0, 3).join(", ") + (item.files.length > 3 ? ", …" : "");
    console.log(`  ${item.value.padEnd(28)} ${String(item.count).padStart(4)}  ${where}`);
  }
}

console.log("Style drift scan");
console.log(`Root: ${root}`);
console.log(`Files: ${cssFiles} CSS, ${htmlFiles} HTML`);
if (tokenFiles.length) console.log(`Token files excluded: ${tokenFiles.join(", ")}`);

lines("Hardcoded colors", report.colors);
lines("Hardcoded font-size (px)", report.fontSizes);
lines("Hardcoded border-radius (px)", report.radii);
lines("Inline style attributes", report.inlineStyles);
console.log(`\nToken references (var(--...)): ${varRefs}`);

const signals = [];
const multiFileColors = colorRank.filter((c) => c.spread >= 2 && c.count >= 2);
if (multiFileColors.length) {
  signals.push(`${multiFileColors.length} hardcoded colors repeat across 2+ files; token candidates or drift.`);
}
const topRadius = radiusRank[0];
if (topRadius && topRadius.count >= 5) {
  signals.push(`Top border-radius "${topRadius.value}" appears ${topRadius.count}x; likely a missing radius token.`);
}
const topFont = fontRank[0];
if (topFont && topFont.count >= 5) {
  signals.push(`Top font-size "${topFont.value}" appears ${topFont.count}x; check the type scale.`);
}
if (report.inlineStyles.occurrences > 0) {
  signals.push(`${report.inlineStyles.occurrences} inline style attributes in HTML; prefer classes/tokens.`);
}
if (varRefs === 0 && report.colors.occurrences > 20) {
  signals.push("No CSS variable references found; the project may not use a token system yet.");
}

console.log("\nSignals");
if (!signals.length) console.log("  No obvious drift signals at this threshold.");
else for (const signal of signals) console.log(`  - ${signal}`);

console.log("\nNext: compare top values with the token file, add tokens first, then replace occurrences.");
