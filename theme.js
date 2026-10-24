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
  const INLINE_SEL = '[style*="rgb"],[style*="#"],[style*="url("]';
  const CANVAS_ATTR = "data-utl-c";       // marks big background <canvas> elements (animated backgrounds)

  // Decorative background images (the blue lines, grids and galaxy patterns) are recoloured pixel by pixel.
  const IMG_STYLE_ID = "utilify-theme-img";
  const MAX_IMG_FETCHES = 40;             // per page load
  const MAX_IMG_BYTES = 3 * 1024 * 1024;  // skip bigger source files
  const MAX_PIXELS = 6e6;                 // skip bigger bitmaps
  const MAX_DATA_CHARS = 3e6;             // skip results bigger than this
  const TOTAL_CACHE_CHARS = 7e6;          // keep the saved copy of all recoloured images under this
  const imgDone = new Map();              // id -> recoloured data: URL (for the current theme)
  const imgSkip = new Set();              // ids that aren't blue decoration (photos, greys) or can't be handled
  const imgFailed = new Set();            // ids we couldn't download this session
  const imgPending = new Map();           // id -> absolute url, found while building and not processed yet
  let imgStyleEl = null;
  let imgWorking = false;
  let imgFetches = 0;
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

  // Returns the declaration value with its blue colours shifted (and decorative background images
  // swapped for their recoloured copies when ready), or null if nothing changed.
  // ctx = { images: bool, base: url, used: () => bool } is only given for background properties.
  function shiftValue(value, T, ctx) {
    const wantImages = !!(ctx && ctx.images && value.indexOf("url(") >= 0);
    if (value.indexOf("#") < 0 && value.indexOf("rgb") < 0 && !wantImages) return null;
    const parts = value.split(/(url\([^)]*\))/); // never touch url(...) contents when recolouring colours
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
    if (wantImages) {
      for (let i = 1; i < parts.length; i += 2) {
        const m = /^url\(\s*(["']?)(.*?)\1\s*\)$/.exec(parts[i]);
        const abs = m && imgCandidate(m[2], ctx.base);
        if (!abs) continue;
        const id = hashStr(abs);
        if (imgDone.has(id)) { parts[i] = "var(--utl-i-" + id + "," + parts[i] + ")"; changed = true; } // original url is the fallback
        else if (!imgSkip.has(id) && !imgFailed.has(id) && ctx.used()) imgPending.set(id, abs);
      }
    }
    return changed ? parts.join("") : null;
  }

  // Walk the declarations in a style block's text. We parse the text rather than iterating the
  // browser's expanded properties, because a shorthand containing var() (e.g. a background that uses
  // rgba(var(--x), .4)) isn't expanded and would be invisible to us.
  function shiftDeclarations(cssText, T, base) {
    let out = "", depth = 0, quote = "", start = 0;
    const flush = (end) => {
      const decl = cssText.slice(start, end);
      start = end + 1;
      const c = decl.indexOf(":");
      if (c < 1) return;
      const name = decl.slice(0, c).trim();
      if (SKIP_PROPS.has(name)) return;
      const raw = decl.slice(c + 1).replace(/\s*!important\s*$/i, "").trim();
      const ctx = base && /^background(-image)?$/i.test(name) ? { images: true, base: base.url, used: base.used } : null;
      const nv = name.charCodeAt(0) === 45 && CHANNEL_NAME_RE.test(name)
        ? shiftChannels(raw, T) || shiftValue(raw, T)
        : shiftValue(raw, T, ctx);
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
    if (!st || (st.indexOf("rgb") < 0 && st.indexOf("#") < 0 && st.indexOf("url(") < 0)) return null;
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

  // ---------- decorative background images ----------
  function imgCandidate(raw, base) {
    try {
      const u = new URL(raw, base || location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const h = u.hostname; // RSI's own site and CDN only; user photos live on media.* and are never touched
      if (h !== "robertsspaceindustries.com" && h !== "cdn.robertsspaceindustries.com") return null;
      return /\.(png|jpe?g|webp|svg)$/i.test(u.pathname) ? u.href : null;
    } catch (_) { return null; }
  }

  // Is a rule's selector matched by anything on the page? (so we don't fetch images nothing uses)
  function selectorUsed(sel) {
    try { return !!document.querySelector(sel.replace(TRAILING_PSEUDO_RE, "") || "*"); } catch (_) { return true; }
  }

  async function fetchBytes(url) {
    try { // RSI's CDN normally allows this directly...
      const r = await fetch(url, { credentials: "omit" });
      if (r.ok) {
        if ((+r.headers.get("content-length") || 0) > MAX_IMG_BYTES) return { skip: true };
        const buf = await r.arrayBuffer();
        return buf.byteLength > MAX_IMG_BYTES ? { skip: true } : { buf, type: r.headers.get("content-type") || "" };
      }
    } catch (_) {}
    try { // ...otherwise ask the background script, which isn't subject to the page's CORS rules
      const res = await chrome.runtime.sendMessage({ type: "fetchImage", url, max: MAX_IMG_BYTES });
      if (res && res.skip) return { skip: true };
      if (res && res.ok) {
        const bin = atob(res.b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return { buf: u8.buffer, type: res.type || "" };
      }
    } catch (_) {}
    return null;
  }

  // SVGs are recoloured as text: only colour attributes and CSS colour declarations are touched
  function recolorSvg(text, T) {
    let changed = false;
    const fix = (v) => { const nv = shiftValue(v, T); if (nv) { changed = true; return nv; } return v; };
    const PROPS = "fill|stroke|stop-color|flood-color|lighting-color|color";
    text = text.replace(new RegExp("\\b(" + PROPS + ")\\s*=\\s*([\"'])(.*?)\\2", "gi"), (m, a, q, v) => a + "=" + q + fix(v) + q);
    text = text.replace(new RegExp("\\b(" + PROPS + ")\\s*:\\s*([^;\"'}]+)", "gi"), (m, a, v) => a + ":" + fix(v.trim()));
    return changed ? text : null;
  }

  // Rasters (PNG/JPEG/WebP) are recoloured pixel by pixel, but only if their colour is overwhelmingly
  // RSI blue; photos and greyscale textures are left exactly as they are.
  async function recolorRaster(buf, type, T) {
    const bmp = await createImageBitmap(new Blob([buf], { type: type || "image/png" }));
    const w = bmp.width, h = bmp.height;
    if (!w || !h || w * h > MAX_PIXELS) { if (bmp.close) bmp.close(); return null; }
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    const img = ctx.getImageData(0, 0, w, h);
    const px = new Uint32Array(img.data.buffer); // little-endian: 0xAABBGGRR

    let opaque = 0, chroma = 0, blue = 0;
    const step = Math.max(1, Math.floor(px.length / 20000));
    for (let i = 0; i < px.length; i += step) {
      const p = px[i];
      if ((p >>> 24) < 25) continue;
      opaque++;
      const [hh, ss] = rgbToHsl(p & 255, (p >>> 8) & 255, (p >>> 16) & 255);
      if (ss >= SAT_MIN) { chroma++; if (hh >= HUE_MIN && hh <= HUE_MAX) blue++; }
    }
    if (!opaque || chroma < opaque * 0.01 || blue < chroma * 0.75) return null; // not blue decoration

    const memo = new Map();
    for (let i = 0; i < px.length; i++) {
      const p = px[i];
      if ((p >>> 24) === 0) continue;
      const key = p & 0xffffff;
      let out = memo.get(key);
      if (out === undefined) {
        const s = shiftRgb(key & 255, (key >>> 8) & 255, (key >>> 16) & 255, T);
        out = s ? (s[0] | (s[1] << 8) | (s[2] << 16)) : -1;
        memo.set(key, out);
      }
      if (out !== -1) px[i] = (p & 0xff000000) | out;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  // -> { data } recoloured, { skip: true } not worth recolouring, or null if the download failed
  async function recolorImage(url, T) {
    const got = await fetchBytes(url);
    if (!got) return null;
    if (got.skip) return { skip: true };
    const isSvg = /svg/i.test(got.type) || /\.svg$/i.test(new URL(url).pathname);
    let data = null;
    if (isSvg) {
      const text = recolorSvg(new TextDecoder().decode(got.buf), T);
      if (text) data = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
    } else {
      data = await recolorRaster(got.buf, got.type, T);
    }
    return data && data.length <= MAX_DATA_CHARS ? { data } : { skip: true };
  }

  function renderImgStyle() {
    if (!imgDone.size) { if (imgStyleEl) imgStyleEl.remove(); imgStyleEl = null; return; }
    if (!imgStyleEl || !imgStyleEl.isConnected) {
      imgStyleEl = document.getElementById(IMG_STYLE_ID) || document.createElement("style");
      imgStyleEl.id = IMG_STYLE_ID;
      (document.head || document.documentElement).appendChild(imgStyleEl);
    }
    let css = ":root{";
    imgDone.forEach((data, id) => { css += "--utl-i-" + id + ':url("' + data + '");'; });
    imgStyleEl.textContent = css + "}";
  }

  function persistImgs() {
    try {
      let total = 0;
      imgDone.forEach((d) => { total += d.length; });
      const rec = { themeImgSkip: [...imgSkip] };
      if (total <= TOTAL_CACHE_CHARS) rec.themeImg = { key: keyOf(theme), items: Object.fromEntries(imgDone) };
      chrome.storage.local.set(rec);
    } catch (_) {}
  }

  async function processPending() {
    if (imgWorking) return;
    imgWorking = true;
    const startKey = keyOf(theme);
    let progressed = false;
    try {
      for (const [id, url] of [...imgPending]) {
        imgPending.delete(id);
        if (imgDone.has(id) || imgSkip.has(id) || imgFailed.has(id)) continue;
        if (imgFetches++ >= MAX_IMG_FETCHES) break;
        let res = null;
        try { res = await recolorImage(url, theme); } catch (_) { res = { skip: true }; }
        if (keyOf(theme) !== startKey) return; // theme changed while we were working: start over
        if (!res) imgFailed.add(id);
        else if (res.skip) imgSkip.add(id);
        else imgDone.set(id, res.data);
        progressed = true;
      }
    } finally { imgWorking = false; }
    if (progressed) { renderImgStyle(); persistImgs(); schedule(0); }
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
          const decl = shiftDeclarations(r.style.cssText, T, { url: (r.parentStyleSheet && r.parentStyleSheet.href) || document.baseURI, used: () => selectorUsed(r.selectorText) });
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
      const decl = shiftDeclarations(el.style.cssText, T, { url: document.baseURI, used: () => true });
      if (decl) { count++; chunks.push("[" + INLINE_ATTR + '="' + key + '"]{' + decl + "}"); }
    });
    seen.forEach((k) => knownInline.add(k));

    // Animated backgrounds are a <canvas> (we can't change its pixels), so tint it with a filter instead:
    // RSI's own background component, plus any other canvas that covers a big part of the window.
    document.querySelectorAll("canvas").forEach((cv) => {
      if (cv.closest(PROTECTED_SEL)) return;
      const r = cv.getBoundingClientRect();
      if (r.width * r.height >= innerWidth * innerHeight * 0.4) cv.setAttribute(CANVAS_ATTR, "1");
    });
    const dh = T.base.hue - UTILIFY_BASE_HUE;
    const f = "{filter:hue-rotate(" + dh + "deg) saturate(" + +(T.base.sat * T.vibe).toFixed(3) + ") brightness(" + T.base.lum + ")!important}";
    chunks.push('[data-rsi-component="BackgroundRiveAnimation"] canvas' + f, "[" + CANVAS_ATTR + "]" + f);
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
    imgDone.clear(); imgPending.clear(); renderImgStyle();
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
    if (imgPending.size) processPending(); // recolour decorative images; schedule() rebuilds when they're ready
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
    try { s = await chrome.storage.local.get(["theme", "themeCss", "themeImg", "themeImgSkip"]); } catch (_) {}
    theme = utilifyNormalizeTheme(s.theme);
    (s.themeImgSkip || []).forEach((id) => imgSkip.add(id));
    if (!utilifyThemeIsDefault(theme) && s.themeCss && s.themeCss.key === keyOf(theme)) {
      cachedCss = s.themeCss.css;
      (s.themeCss.inline || []).forEach((k) => knownInline.add(k));
      inject(cachedCss);          // themed from the very first paint
      injectedFromCache = true;
    }
    if (!utilifyThemeIsDefault(theme) && s.themeImg && s.themeImg.key === keyOf(theme)) {
      Object.entries(s.themeImg.items || {}).forEach(([id, d]) => imgDone.set(id, d)); // recoloured images, also before first paint
      renderImgStyle();
    }
    watchStylesheets();
    schedule(0);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.theme) return;
      theme = utilifyNormalizeTheme(changes.theme.newValue);
      cachedCss = ""; injectedFromCache = false;
      imgDone.clear(); imgPending.clear(); imgFailed.clear(); imgFetches = 0; renderImgStyle(); // images are recoloured per theme
      schedule(0); // popup changed the theme: apply right away
    });
  }
  start();
})();
