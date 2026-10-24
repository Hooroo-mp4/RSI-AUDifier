(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT"]);

  // "$49.50 USD", "$1,200", or "686.40 USD" (no $ sign, as on Star Citizen Hangar XPLORer)
  const PRICE_RE = /(?<![\w.,])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)(\s*USD\b)?/g;
  // A node that is only a number, e.g. "686.40" when "USD" lives in a separate element
  const NUM_ONLY_RE = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

  const audFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
  const numFmt = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ANIM = { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

  let rate = null;
  let permanent = false; // "always show AUD" setting (popup toggle)

  // ---------- rate + settings ----------
  async function requestRate() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRate" });
      if (res && res.rate) setRate(res.rate);
    } catch (_) { /* extension was reloaded; refreshing the page fixes it */ }
  }

  const allPriceWraps = () => [...document.querySelectorAll(".rsi-aud-wrap:not(.rsi-aud-label)")].filter((w) => w._group);

  function setRate(newRate) {
    if (newRate === rate) return;
    rate = newRate;
    allPriceWraps().forEach((w) => { renderAud(w); applyGroup(w._group, w._group.hover); });
  }

  function setPermanent(value) {
    if (permanent === value) return;
    permanent = value;
    const wraps = [...allPriceWraps()];
    const animate = wraps.length <= 60; // don't animate hundreds of prices at once
    wraps.forEach((w) => applyGroup(w._group, animate));
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.rate && changes.rate.newValue) setRate(changes.rate.newValue);
      if (changes.permanent) setPermanent(!!changes.permanent.newValue);
    });
  } catch (_) {}

  function renderAud(wrap) {
    const layer = wrap._audL;
    const usd = parseFloat(wrap.dataset.usd);
    if (!rate || isNaN(usd)) { layer.textContent = "…"; return; }
    const value = usd * rate;
    const hasLabel = wrap.dataset.label === "1"; // separate "USD" element that flips to "AUD"
    const suffix = wrap.dataset.suffix === "1";   // "USD" is part of the price text itself
    let text;
    if (wrap.dataset.sym === "1") {
      text = audFmt.format(value);
      if (suffix) text += " AUD";
      else if (!hasLabel) text = "A" + text;
    } else {
      text = numFmt.format(value) + (suffix ? " AUD" : "");
    }
    layer.textContent = text;
  }

  // ---------- showing USD vs AUD ----------
  function inheritedDecoration(node) {
    for (let a = node.parentElement; a; a = a.parentElement) {
      const d = getComputedStyle(a).textDecorationLine;
      if (d && d !== "none") return d;
    }
    return "";
  }

  // Swap one wrapper between its USD layer and AUD layer, with a swipe-up animation
  function swap(wrap, toAud, animate) {
    if (wrap._view === toAud) return;
    if (wrap._anims) wrap._anims.forEach((a) => a.cancel());
    const usdL = wrap._usdL, audL = wrap._audL;
    const inL = toAud ? audL : usdL;
    const outL = toAud ? usdL : audL;
    wrap._view = toAud;

    const settle = () => {
      wrap.classList.remove("rsi-animating");
      wrap.style.clipPath = "";
      wrap.style.textDecoration = "";
      usdL.classList.remove("rsi-incoming");
      audL.classList.remove("rsi-incoming");
      wrap.classList.toggle("rsi-show-aud", toAud);
      wrap._anims = null;
    };

    if (!animate || REDUCED_MOTION || !wrap.animate) { settle(); return; }

    outL.classList.remove("rsi-incoming");
    inL.classList.add("rsi-incoming");
    const deco = inheritedDecoration(wrap); // inline-blocks don't inherit strike-through, so copy it
    if (deco) wrap.style.textDecoration = deco;
    wrap.classList.add("rsi-animating");
    wrap.style.clipPath = "inset(-0.1em -400px)"; // clip top/bottom only
    const wOut = outL.getBoundingClientRect().width;
    const wIn = inL.getBoundingClientRect().width;
    const a1 = outL.animate(
      [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], ANIM);
    const a2 = inL.animate(
      [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], ANIM);
    // Glide the box from the old text's width to the new text's width (USD vs AUD differ by a few px),
    // so the final layout matches the last animation frame and nothing shifts at the end.
    const a3 = wrap.animate([{ width: wOut + "px" }, { width: wIn + "px" }], ANIM);
    wrap._anims = [a1, a2, a3];
    Promise.all([a1.finished, a2.finished, a3.finished]).then(() => {
      if (wrap._anims && wrap._anims[0] === a1) { settle(); a1.cancel(); a2.cancel(); a3.cancel(); }
    }).catch(() => {}); // cancelled by a newer swap
  }

  function wantAud(group) {
    return rate != null && permanent !== group.hover; // permanent mode: hovering peeks at USD
  }
  function applyGroup(group, animate) {
    const t = wantAud(group);
    group.forEach((w) => swap(w, t, animate));
  }

  function enter(group) {
    clearTimeout(group.timer);
    group.hover = true;
    applyGroup(group, true);
    requestRate(); // background script no-ops if the cached rate is fresh
  }
  function leave(group) {
    clearTimeout(group.timer);
    group.timer = setTimeout(() => { group.hover = false; applyGroup(group, true); }, 40);
  }
  function addHoverListeners(w) {
    w.addEventListener("mouseenter", () => enter(w._group));
    w.addEventListener("mouseleave", () => leave(w._group));
  }

  // ---------- DOM helpers ----------
  const el = (cls) => { const s = document.createElement("span"); s.className = cls; return s; };

  function isSkippable(node) {
    const p = node.parentElement;
    if (!p || SKIP_TAGS.has(p.tagName) || p.isContentEditable) return true;
    return !!p.closest(".rsi-aud-wrap");
  }

  // Split off surrounding whitespace so the node is exactly its trimmed text
  function isolate(node) {
    const v = node.nodeValue;
    const lead = v.length - v.trimStart().length;
    const trail = v.length - v.trimEnd().length;
    let n = node;
    if (lead) n = n.splitText(lead);
    if (trail) n.splitText(n.nodeValue.length - trail);
    return n;
  }

  function buildPriceWrap(textNode, usdValue, hasSymbol, hasSuffix) {
    const wrap = el("rsi-aud-wrap");
    wrap.dataset.usd = String(usdValue);
    wrap.dataset.sym = hasSymbol ? "1" : "0";
    wrap.dataset.suffix = hasSuffix ? "1" : "0";
    const usdL = el("rsi-aud-layer rsi-aud-usd");
    const audL = el("rsi-aud-layer rsi-aud-aud");
    audL.setAttribute("aria-hidden", "true");
    textNode.parentNode.insertBefore(wrap, textNode);
    usdL.appendChild(textNode); // move (not copy) so the site's own references stay valid
    wrap.append(usdL, audL);
    wrap._usdL = usdL; wrap._audL = audL; wrap._view = false;
    const group = [wrap];
    group.hover = false;
    wrap._group = group;
    addHoverListeners(wrap);
    renderAud(wrap);
    applyGroup(group, false); // in "always AUD" mode, new prices appear already converted
    return wrap;
  }

  function buildLabelWrap(label) {
    const lw = el("rsi-aud-wrap rsi-aud-label");
    const usdL = el("rsi-aud-layer rsi-aud-usd");
    const audL = el("rsi-aud-layer rsi-aud-aud");
    audL.setAttribute("aria-hidden", "true");
    let node = label;
    if (node.nodeType === Node.TEXT_NODE) {
      node = isolate(node);
      audL.textContent = "AUD";
    } else {
      const clone = node.cloneNode(false); // keeps classes/styling (e.g. small caps)
      clone.removeAttribute("id");
      clone.textContent = "AUD";
      audL.appendChild(clone);
    }
    node.parentNode.insertBefore(lw, node);
    usdL.appendChild(node);
    lw.append(usdL, audL);
    lw._usdL = usdL; lw._audL = audL; lw._view = false;
    return lw;
  }

  // A price "has a label" only if its paired USD label is still on the page
  const hasLiveLabel = (w) => !!w._group && w._group.some((x) => x !== w && x.isConnected);
  function pruneGroup(g) { g.splice(0, g.length, ...g.filter((x) => x.isConnected)); }

  function link(priceWrap, label) {
    if (hasLiveLabel(priceWrap)) return;
    pruneGroup(priceWrap._group);
    const lw = buildLabelWrap(label);
    priceWrap.dataset.label = "1";
    lw._group = priceWrap._group;
    lw._group.push(lw);
    addHoverListeners(lw);
    renderAud(priceWrap);
    swap(lw, priceWrap._view, false); // match whatever the price is showing right now
  }

  // ---------- pass 1: find price text ----------
  function findMatch(text) {
    for (const m of text.matchAll(PRICE_RE)) {
      const dollar = !!m[1], usd = !!m[4];
      const whole = text.trim() === m[0].trim();
      if ((dollar && (usd || whole)) || (!dollar && usd)) return m;
    }
    return null;
  }

  function wrapPrice(textNode) {
    if (!textNode.isConnected || isSkippable(textNode)) return;
    const m = findMatch(textNode.nodeValue);
    if (!m) return;
    let target = textNode;
    if (m.index > 0) target = textNode.splitText(m.index);
    const tail = target.nodeValue.length > m[0].length ? target.splitText(m[0].length) : null;
    const value = parseFloat(m[2].replace(/,/g, "") + "." + (m[3] || "0"));
    buildPriceWrap(target, value, !!m[1], !!m[4]);
    if (tail) wrapPrice(tail);
  }

  // ---------- pass 2: pair separate "USD" labels with the price just before them ----------
  // Walks backwards through the page's text, so it doesn't matter how the site nests its elements.
  function findPriceBefore(startText, label) {
    let limit = label.nodeType === Node.ELEMENT_NODE ? label : label.parentElement;
    for (let i = 0; i < 4 && limit.parentElement && limit.parentElement !== document.body; i++) {
      limit = limit.parentElement;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    walker.currentNode = startText;
    let t;
    while ((t = walker.previousNode())) {
      if (!limit.contains(t)) return null;
      if (!t.nodeValue.trim()) continue;
      const pe = t.parentElement;
      if (!pe) return null;
      if (pe.closest(".rsi-aud-aud")) continue;            // our own AUD text
      if (SKIP_TAGS.has(pe.tagName)) continue;
      if (pe.closest(".rsi-aud-label")) return null;       // previous thing was another label
      const w = pe.closest(".rsi-aud-wrap");
      if (w) return !w._group || hasLiveLabel(w) || w.dataset.suffix === "1" ? null : { wrap: w };
      return NUM_ONLY_RE.test(t.nodeValue.trim()) ? { node: t } : null;
    }
    return null;
  }

  function scanLabels(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.includes("USD") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const n of nodes) {
      if (!n.isConnected || isSkippable(n) || n.nodeValue.trim() !== "USD") continue;
      let label = n;
      const p = n.parentElement;
      if (p && p !== document.body && p.children.length === 0 && p.textContent.trim() === "USD") label = p;

      const found = findPriceBefore(n, label);
      if (!found) continue;
      if (found.wrap) { link(found.wrap, label); continue; }

      const t = found.node.nodeValue.trim();
      const tn = isolate(found.node);
      const wrap = buildPriceWrap(tn, parseFloat(t.replace(/[$,\s]/g, "")), t.includes("$"), false);
      link(wrap, label);
    }
  }

  // If the site re-renders a price (e.g. the cart subtotal after "Add to cart") our wrapper around the
  // number is discarded but the label wrapper survives. Pair each orphaned label with the new price.
  function relinkOrphanLabels(root) {
    root.querySelectorAll(".rsi-aud-label").forEach((lw) => {
      const g = lw._group;
      if (!g || (g[0] && g[0].isConnected)) return;
      const tw = document.createTreeWalker(lw._usdL, NodeFilter.SHOW_TEXT);
      const startText = tw.nextNode();
      if (!startText) return;
      const found = findPriceBefore(startText, lw);
      if (!found) return;
      let price = found.wrap;
      if (!price) {
        const t = found.node.nodeValue.trim();
        price = buildPriceWrap(isolate(found.node), parseFloat(t.replace(/[$,\s]/g, "")), t.includes("$"), false);
      }
      pruneGroup(price._group);
      price.dataset.label = "1";
      lw._group = price._group;
      price._group.push(lw);
      renderAud(price);
      swap(lw, price._view, false);
    });
  }

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      wrapPrice(root);
      root = root.parentElement;
      if (!root) return;
    } else if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) {
      return;
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue.includes("$") || n.nodeValue.includes("USD") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(wrapPrice);
    }
    // Labels can arrive separately from their number, so look a few levels up
    let labelRoot = root;
    for (let i = 0; i < 3 && labelRoot.parentElement && labelRoot.parentElement !== document.body; i++) {
      labelRoot = labelRoot.parentElement;
    }
    scanLabels(labelRoot);
    relinkOrphanLabels(labelRoot);
  }

  // ---------- keep up with prices the site (or other extensions) render later ----------
  const queue = new Set();
  let timer = null;
  function enqueue(node) {
    queue.add(node);
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        const items = [...queue];
        queue.clear();
        items.forEach((n) => { if (n.isConnected) scan(n); });
      }, 100);
    }
  }

  function refreshWrapFromText(wrap) {
    const text = wrap._usdL.textContent;
    const m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return;
    wrap.dataset.usd = String(parseFloat(m[1].replace(/,/g, "") + "." + (m[2] || "0")));
    renderAud(wrap);
  }

  function observe() {
    new MutationObserver((mutations) => {
      for (const mu of mutations) {
        if (mu.type === "characterData") {
          // The site updated a price we've already wrapped (e.g. a total was recalculated)
          const pe = mu.target.parentElement;
          const w = pe && pe.closest(".rsi-aud-wrap:not(.rsi-aud-label)");
          if (w && pe.closest(".rsi-aud-usd")) refreshWrapFromText(w);
          else enqueue(mu.target);
        } else {
          mu.addedNodes.forEach((n) => {
            const host = n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
            if (host && host.closest(".rsi-aud-wrap")) return;
            enqueue(n);
          });
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  async function init() {
    try {
      const s = await chrome.storage.local.get("permanent");
      permanent = !!s.permanent;
    } catch (_) {}
    observe();
    scan(document.body);
    requestRate();
  }
  init();
})();
