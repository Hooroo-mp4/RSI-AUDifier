// Utilify theme engine (content script, runs at document_start).
//
// RSI colours its site with a blue palette spread across thousands of CSS declarations (design tokens
// and hard-coded values). To re-theme it we read RSI's own stylesheets, find every blue colour and
// write an override rule with the hue shifted. Reds, oranges and greens (sale prices, errors, buttons)
// are left alone. The generated CSS is cached so later page loads are themed from the first paint.
(() => {
  "use strict";
  const STYLE_ID = "utilify-theme-css";
  const VERSION = chrome.runtime.getManifest().version;
  const HUE_MIN = 185, HUE_MAX = 232, SAT_MIN = 0.1; // what counts as "RSI blue"
  const ACCENT_MIN_SAT = 0.75, ACCENT_MIN_LIGHT = 0.4; // bright + saturated blue = accent, the rest = base
  const MIN_RULES_TO_TRUST = 10;                     // fewer than this means RSI's CSS hasn't loaded yet
  const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[\d.%\s,\/-]+\)/gi;
  const SKIP_PROPS = new Set(["content", "font-family", "quotes", "grid-template-areas", "src"]);

  // Other tools' interfaces on RSI pages are left exactly as their authors made them. Star Citizen
  // Hangar XPLORer adds its filter buttons, sort/search/pager and the total-spend panel inside these
  // two containers (and reuses RSI's old class names so they look native, which we must not recolour).
  const PROTECTED_ROOTS = [".js-custom-controls", ".js-bulk-ui"];
  const PROTECT_NOT = ":not(" + PROTECTED_ROOTS.map((r) => r + "," + r + " *").join(",") + ")";
  const PROTECTED_SEL = PROTECTED_ROOTS.join(",");
  const TRAILING_PSEUDO_RE = /(::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?)$/i;

  const INLINE_ATTR = "data-utl-s";       // marks elements whose inline style has blue colours in it
  const INLINE_SEL = '[style*="rgb"],[style*="#"]';
  const knownInline = new Set();           // inline-style fingerprints we already have override rules for

  let theme = utilifyNormalizeTheme(null);
  let styleEl = null;
  let injectedFromCache = false;
  let cachedCss = "";
  let timer = null;

  // ---------- colour maths ----------
  function parseColor(str) {
    let r, g, b, a = 1;
    if (str[0] === "#") {
      let h = str.slice(1);
      if (h.length <= 4) h = [...h].map((c) => c + c).join("");
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
    } else {
      const parts = str.slice(str.indexOf("(") + 1, -1).split(/[\s,\/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const ch = (x) => (x.endsWith("%") ? parseFloat(x) * 2.55 : parseFloat(x));
      [r, g, b] = parts.slice(0, 3).map(ch);
      if (parts[3] !== undefined) a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    }
    return [r, g, b, a].some(Number.isNaN) ? null : { r, g, b, a };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [r, g, b].map((v) => Math.round((v + m) * 255));
  }

  // RSI's blues come in two kinds: a dark "base" ramp (backgrounds, panels, text tints) and a bright,
  // highly saturated "accent" blue (buttons, links). A theme recolours each separately.
  // Returns [r, g, b], or null if this isn't one of RSI's blues.
  function shiftRgb(r, g, b, T) {
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < SAT_MIN || h < HUE_MIN || h > HUE_MAX) return null;
    if (s >= ACCENT_MIN_SAT && l >= ACCENT_MIN_LIGHT) { // accent
      const A = T.accent;
      return hslToRgb((h + (A.hue - UTILIFY_ACCENT_HUE) + 360) % 360, Math.min(1, s * A.sat * T.vibe), Math.min(0.97, l * A.lum));
    }
    const B = T.base; // surfaces: brightness change fades out towards light text tints so text stays readable
    const w = Math.min(1, Math.max(0, (0.55 - l) / 0.25));
    return hslToRgb((h + (B.hue - UTILIFY_BASE_HUE) + 360) % 360, Math.min(1, s * B.sat * T.vibe), Math.min(0.97, l * (1 + (B.lum - 1) * w)));
  }

  function shiftColor(c, T) {
    const rgb = shiftRgb(c.r, c.g, c.b, T);
    if (!rgb) return null;
    const [r, g, b] = rgb;
    return c.a < 1 ? "rgb(" + r + " " + g + " " + b + " / " + +c.a.toFixed(3) + ")" : "rgb(" + r + " " + g + " " + b + ")";
  }

  // RSI stores much of its palette as bare channel numbers, e.g. --orion-color-primary-4-rgb: 25,73,103
  // (used later as rgb(var(--...))). Shift those too.
  const CHANNEL_NAME_RE = /rgb|colou?r/i;
  const CHANNELS_RE = /^\s*(\d+(?:\.\d+)?)\s*([, ])\s*(\d+(?:\.\d+)?)\s*\2\s*(\d+(?:\.\d+)?)\s*$/;
  function shiftChannels(value, T) {
    const m = CHANNELS_RE.exec(value);
    if (!m) return null;
    const rgb = shiftRgb(+m[1], +m[3], +m[4], T);
    return rgb ? rgb.join(m[2] === "," ? "," : " ") : null;
  }

  // Returns the declaration value with its blue colours shifted, or null if nothing changed
  function shiftValue(value, T) {
    if (value.indexOf("#") < 0 && value.indexOf("rgb") < 0) return null;
    const parts = value.split(/(url\([^)]*\))/); // never touch url(...) contents
    let changed = false;
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(COLOR_RE, (m) => {
        const c = parseColor(m);
        const out = c && shiftColor(c, T);
        if (!out) return m;
        changed = true;
        return out;
      });
    }
    return changed ? parts.join("") : null;
  }

  // Walk the declarations in a style block's text. We parse the text rather than iterating the
  // browser's expanded properties, because a shorthand containing var() (e.g. a background that uses
  // rgba(var(--x), .4)) isn't expanded and would be invisible to us.
  function shiftDeclarations(cssText, T) {
    let out = "", depth = 0, quote = "", start = 0;
    const flush = (end) => {
      const decl = cssText.slice(start, end);
      start = end + 1;
      const c = decl.indexOf(":");
      if (c < 1) return;
      const name = decl.slice(0, c).trim();
      if (SKIP_PROPS.has(name)) return;
      const raw = decl.slice(c + 1).replace(/\s*!important\s*$/i, "").trim();
      const nv = name.charCodeAt(0) === 45 && CHANNEL_NAME_RE.test(name)
        ? shiftChannels(raw, T) || shiftValue(raw, T)
        : shiftValue(raw, T);
      if (nv) out += name + ":" + nv + "!important;";
    };
    for (let i = 0; i < cssText.length; i++) {
      const ch = cssText[i];
      if (quote) { if (ch === quote && cssText[i - 1] !== "\\") quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) flush(i);
    }
    flush(cssText.length);
    return out;
  }

  // ---------- inline styles ----------
  // Some of RSI's colours (like the page background gradient) are set in an element's style="..."
  // attribute, which a stylesheet rule can't select. We tag such elements with a fingerprint of their
  // style text and write a rule for that fingerprint. (Fingerprints are stable, so cached CSS still works.)
  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function tagInline(el) {
    const st = el.getAttribute && el.getAttribute("style");
    if (!st || (st.indexOf("rgb") < 0 && st.indexOf("#") < 0)) return null;
    if (el.closest && el.closest(PROTECTED_SEL)) return null; // someone else's UI: leave it alone
    const key = hashStr(st);
    if (el.getAttribute(INLINE_ATTR) !== key) el.setAttribute(INLINE_ATTR, key);
    return key;
  }

  // Only RSI's own stylesheets are recoloured, never another extension's or site's.
  function isRsiSheet(sheet) {
    const node = sheet.ownerNode;
    if (node && node.id && (node.id === STYLE_ID || /^HangarXPLOR/i.test(node.id))) return false;
    if (!sheet.href) return true; // inline <style>
    try {
      const host = new URL(sheet.href).hostname;
      return host === "robertsspaceindustries.com" || host.endsWith(".robertsspaceindustries.com");
    } catch (_) { return false; }
  }

  // Add ":not(<protected containers>)" to each selector so a rule never applies inside them
  function protectSelector(sel) {
    const parts = [];
    let depth = 0, quote = "", start = 0;
    for (let i = 0; i <= sel.length; i++) {
      const ch = sel[i];
      if (i === sel.length || (ch === "," && depth === 0 && !quote)) { parts.push(sel.slice(start, i)); start = i + 1; continue; }
      if (quote) { if (ch === quote && sel[i - 1] !== "\\") quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    return parts.map((p) => {
      p = p.trim();
      const m = TRAILING_PSEUDO_RE.exec(p);
      return m ? p.slice(0, m.index) + PROTECT_NOT + m[1] : p + PROTECT_NOT;
    }).join(",");
  }

  // ---------- build override CSS from RSI's own stylesheets ----------
  function build(T) {
    const chunks = [];
    let count = 0;

    // RSI's new design-system sheets (cig-tbl_*) never style other tools' legacy-class markup, so only
    // the older sheets need the protection (keeps the generated CSS small)
    const visit = (rules, wrappers, protect) => {
      for (const r of rules) {
        if (r instanceof CSSStyleRule) {
          const decl = shiftDeclarations(r.style.cssText, T);
          if (decl) {
            count++;
            const sel = protect ? protectSelector(r.selectorText) : r.selectorText;
            chunks.push(wrappers.reduceRight((acc, w) => w + "{" + acc + "}", sel + "{" + decl + "}"));
          }
        } else if (r.cssRules && !(r instanceof CSSKeyframesRule)) { // @media, @supports, @container ...
          const text = r.cssText;
          visit(r.cssRules, wrappers.concat(text.slice(0, text.indexOf("{")).trim()), protect);
        } else if (r instanceof CSSImportRule && r.styleSheet && isRsiSheet(r.styleSheet)) {
          try { visit(r.styleSheet.cssRules, wrappers, protect); } catch (_) {}
        }
      }
    };

    for (const sheet of document.styleSheets) {
      if (!isRsiSheet(sheet)) continue;
      const protect = !(sheet.ownerNode && /^cig-tbl_/.test(sheet.ownerNode.id || ""));
      try { visit(sheet.cssRules, [], protect); } catch (_) { /* cross-origin sheet we can't read */ }
    }

    // Colours set directly in style="..." attributes
    const seen = new Set();
    document.querySelectorAll(INLINE_SEL).forEach((el) => {
      const key = tagInline(el);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const decl = shiftDeclarations(el.style.cssText, T);
      if (decl) { count++; chunks.push("[" + INLINE_ATTR + '="' + key + '"]{' + decl + "}"); }
    });
    seen.forEach((k) => knownInline.add(k));

    // The animated background is a <canvas>, so tint it with a filter instead
    const dh = T.base.hue - UTILIFY_BASE_HUE;
    chunks.push('[data-rsi-component="BackgroundRiveAnimation"] canvas{filter:hue-rotate(' + dh + "deg) saturate(" + +(T.base.sat * T.vibe).toFixed(3) + ") brightness(" + T.base.lum + ")!important}");
    return { css: chunks.join("\n"), count };
  }

  // ---------- applying ----------
  function inject(css, count) {
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.getElementById(STYLE_ID) || document.createElement("style");
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
    if (count !== undefined) styleEl.dataset.rules = String(count);
  }

  function removeStyle() {
    if (styleEl) styleEl.remove();
    styleEl = null; injectedFromCache = false;
  }

  const keyOf = (T) => VERSION + "|" + JSON.stringify(T);

  function rebuild() {
    timer = null;
    if (utilifyThemeIsDefault(theme)) { removeStyle(); return; }
    const t0 = performance.now();
    const { css, count } = build(theme);
    if (count < MIN_RULES_TO_TRUST && injectedFromCache) return; // RSI's CSS isn't here yet: keep the cached theme
    inject(css, count);
    if (styleEl) styleEl.dataset.ms = String(Math.round(performance.now() - t0));
    injectedFromCache = false;
    if (count >= MIN_RULES_TO_TRUST && css !== cachedCss) {
      cachedCss = css;
      try { chrome.storage.local.set({ themeCss: { key: keyOf(theme), css, inline: [...knownInline] } }); } catch (_) {}
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, delay);
  }

  // RSI injects its stylesheets as the app starts up, so rebuild whenever new ones appear
  function watchStylesheets() {
    const isSheet = (n) => n.nodeType === 1 && (n.nodeName === "STYLE" || (n.nodeName === "LINK" && /stylesheet/i.test(n.rel))) && n.id !== STYLE_ID;
    // Tag new elements straight away (so cached rules apply before the next paint); rebuild if one is new to us
    const tagTree = (n) => {
      if (n.nodeType !== 1) return false;
      let fresh = false;
      const check = (el) => { const k = tagInline(el); if (k && !knownInline.has(k)) fresh = true; };
      check(n);
      if (n.querySelectorAll) n.querySelectorAll(INLINE_SEL).forEach(check);
      return fresh;
    };
    new MutationObserver((muts) => {
      if (utilifyThemeIsDefault(theme)) return;
      let rebuildNeeded = false;
      for (const m of muts) {
        if (m.target.nodeName === "STYLE" && m.target.id !== STYLE_ID) rebuildNeeded = true;
        for (const n of m.addedNodes) { if (isSheet(n)) rebuildNeeded = true; else if (tagTree(n)) rebuildNeeded = true; }
      }
      if (rebuildNeeded) schedule(250);
    }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("load", (e) => { if (e.target && e.target.nodeName === "LINK") schedule(150); }, true);
    document.addEventListener("DOMContentLoaded", () => schedule(100));
    window.addEventListener("load", () => schedule(300));
  }

  async function start() {
    let s = {};
    try { s = await chrome.storage.local.get(["theme", "themeCss"]); } catch (_) {}
    theme = utilifyNormalizeTheme(s.theme);
    if (!utilifyThemeIsDefault(theme) && s.themeCss && s.themeCss.key === keyOf(theme)) {
      cachedCss = s.themeCss.css;
      (s.themeCss.inline || []).forEach((k) => knownInline.add(k));
      inject(cachedCss);          // themed from the very first paint
      injectedFromCache = true;
    }
    watchStylesheets();
    schedule(0);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.theme) return;
      theme = utilifyNormalizeTheme(changes.theme.newValue);
      cachedCss = ""; injectedFromCache = false;
      schedule(0); // popup changed the theme: apply right away
    });
  }
  start();
})();
