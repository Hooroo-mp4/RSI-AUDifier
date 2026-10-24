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
  const MIN_RULES_TO_TRUST = 10;                     // fewer than this means RSI's CSS hasn't loaded yet
  const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[\d.%\s,\/-]+\)/gi;
  const SKIP_PROPS = new Set(["content", "font-family", "quotes", "grid-template-areas", "src"]);

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

  // Returns [r, g, b] with the hue shifted, or null if this isn't one of RSI's blues
  function shiftRgb(r, g, b, T) {
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < SAT_MIN || h < HUE_MIN || h > HUE_MAX) return null;
    return hslToRgb((h + (T.hue - UTILIFY_BASE_HUE) + 360) % 360, Math.min(1, s * T.sat), l);
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

  // ---------- build override CSS from RSI's own stylesheets ----------
  function build(T) {
    const chunks = [];
    let count = 0;

    const visit = (rules, wrappers) => {
      for (const r of rules) {
        if (r instanceof CSSStyleRule) {
          let decl = "";
          for (let i = 0; i < r.style.length; i++) {
            const name = r.style[i];
            if (SKIP_PROPS.has(name)) continue;
            const raw = r.style.getPropertyValue(name);
            const nv = name.charCodeAt(0) === 45 && CHANNEL_NAME_RE.test(name)
              ? shiftChannels(raw, T) || shiftValue(raw, T)
              : shiftValue(raw, T);
            if (nv) decl += name + ":" + nv + "!important;";
          }
          if (decl) {
            count++;
            chunks.push(wrappers.reduceRight((acc, w) => w + "{" + acc + "}", r.selectorText + "{" + decl + "}"));
          }
        } else if (r.cssRules && !(r instanceof CSSKeyframesRule)) { // @media, @supports, @container ...
          const text = r.cssText;
          visit(r.cssRules, wrappers.concat(text.slice(0, text.indexOf("{")).trim()));
        } else if (r instanceof CSSImportRule && r.styleSheet) {
          try { visit(r.styleSheet.cssRules, wrappers); } catch (_) {}
        }
      }
    };

    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && sheet.ownerNode.id === STYLE_ID) continue;
      try { visit(sheet.cssRules, []); } catch (_) { /* cross-origin sheet we can't read */ }
    }

    // The animated background is a <canvas>, so tint it with a filter instead
    const dh = T.hue - UTILIFY_BASE_HUE;
    chunks.push('[data-rsi-component="BackgroundRiveAnimation"] canvas{filter:hue-rotate(' + dh + "deg) saturate(" + T.sat + ")!important}");
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

  const keyOf = (T) => VERSION + "|" + T.hue + "|" + T.sat;

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
      try { chrome.storage.local.set({ themeCss: { key: keyOf(theme), css } }); } catch (_) {}
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, delay);
  }

  // RSI injects its stylesheets as the app starts up, so rebuild whenever new ones appear
  function watchStylesheets() {
    const isSheet = (n) => n.nodeType === 1 && (n.nodeName === "STYLE" || (n.nodeName === "LINK" && /stylesheet/i.test(n.rel))) && n.id !== STYLE_ID;
    new MutationObserver((muts) => {
      for (const m of muts) {
        if ((m.target.nodeName === "STYLE" && m.target.id !== STYLE_ID) || [...m.addedNodes].some(isSheet)) { schedule(250); return; }
      }
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
