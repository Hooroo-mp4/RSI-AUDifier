(() => {
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT"]);

  // "$49.50 USD", "$1,200", or "686.40 USD" (no $ sign, as on Star Citizen Hangar XPLORer)
  const PRICE_RE = /(?<![\w.,])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)(\s*USD\b)?/g;
  // A node that is only a number, e.g. "686.40" when "USD" lives in a separate element
  const NUM_ONLY_RE = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

  const audFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
  const numFmt = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let rate = null;

  // ---------- rate handling ----------
  async function requestRate() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRate" });
      if (res && res.rate) setRate(res.rate);
    } catch (_) { /* extension was reloaded; refreshing the page fixes it */ }
  }

  function setRate(newRate) {
    if (newRate === rate) return;
    rate = newRate;
    document.querySelectorAll(".rsi-aud-wrap:not(.rsi-aud-label)").forEach(renderAud);
  }

  function renderAud(wrap) {
    const layer = wrap.querySelector(".rsi-aud-aud");
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

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.rate && changes.rate.newValue) setRate(changes.rate.newValue);
    });
  } catch (_) {}

  // ---------- hover state (price and its USD label animate together) ----------
  function enter(group) {
    clearTimeout(group.timer);
    group.forEach((w) => w.classList.add("rsi-active"));
    requestRate(); // background script no-ops if the cached rate is fresh
  }
  function leave(group) {
    clearTimeout(group.timer);
    group.timer = setTimeout(() => group.forEach((w) => w.classList.remove("rsi-active")), 40);
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
    const usdLayer = el("rsi-aud-layer rsi-aud-usd");
    const audLayer = el("rsi-aud-layer rsi-aud-aud");
    audLayer.setAttribute("aria-hidden", "true");
    textNode.parentNode.insertBefore(wrap, textNode);
    usdLayer.appendChild(textNode); // move (not copy) so the site's own references stay valid
    wrap.append(usdLayer, audLayer);
    wrap._group = [wrap];
    addHoverListeners(wrap);
    renderAud(wrap);
    return wrap;
  }

  function buildLabelWrap(label) {
    const lw = el("rsi-aud-wrap rsi-aud-label");
    const usdLayer = el("rsi-aud-layer rsi-aud-usd");
    const audLayer = el("rsi-aud-layer rsi-aud-aud");
    audLayer.setAttribute("aria-hidden", "true");
    let node = label;
    if (node.nodeType === Node.TEXT_NODE) {
      node = isolate(node);
      audLayer.textContent = "AUD";
    } else {
      const clone = node.cloneNode(false); // keeps classes/styling (e.g. small caps)
      clone.removeAttribute("id");
      clone.textContent = "AUD";
      audLayer.appendChild(clone);
    }
    node.parentNode.insertBefore(lw, node);
    usdLayer.appendChild(node);
    lw.append(usdLayer, audLayer);
    return lw;
  }

  function link(priceWrap, label) {
    if (priceWrap.dataset.label === "1") return;
    const lw = buildLabelWrap(label);
    priceWrap.dataset.label = "1";
    lw._group = priceWrap._group;
    lw._group.push(lw);
    addHoverListeners(lw);
    renderAud(priceWrap);
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

  // ---------- pass 2: find separate "USD" labels and pair them with the number before them ----------
  function firstTextNode(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    return w.nextNode();
  }

  function findPriceBefore(label) {
    let cur = label;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
      let p = cur.previousSibling;
      while (p && p.nodeType === Node.TEXT_NODE && !p.nodeValue.trim()) p = p.previousSibling;
      if (p) {
        if (p.nodeType === Node.ELEMENT_NODE) {
          const w = p.matches(".rsi-aud-wrap") ? p : p.querySelector(".rsi-aud-wrap:not(.rsi-aud-label)");
          if (w && !w.classList.contains("rsi-aud-label")) {
            const usdText = (w.querySelector(".rsi-aud-usd") || w).textContent.trim();
            if (p.textContent.trim() === w.textContent.trim() || NUM_ONLY_RE.test(usdText)) return { wrap: w };
          }
        }
        const t = p.textContent.trim();
        return NUM_ONLY_RE.test(t) ? { node: p } : null;
      }
      cur = cur.parentNode;
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

      const found = findPriceBefore(label);
      if (!found) continue;

      if (found.wrap) { link(found.wrap, label); continue; }

      let tn = found.node.nodeType === Node.TEXT_NODE ? found.node : firstTextNode(found.node);
      if (!tn) continue;
      const t = tn.nodeValue.trim();
      if (!NUM_ONLY_RE.test(t)) continue;
      tn = isolate(tn);
      const wrap = buildPriceWrap(tn, parseFloat(t.replace(/[$,\s]/g, "")), t.includes("$"), false);
      link(wrap, label);
    }
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
    const text = (wrap.querySelector(".rsi-aud-usd") || wrap).textContent;
    const m = text.match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
    if (!m) return;
    wrap.dataset.usd = String(parseFloat(m[1].replace(/,/g, "") + "." + (m[2] || "0")));
    renderAud(wrap);
  }

  new MutationObserver((mutations) => {
    for (const mu of mutations) {
      if (mu.type === "characterData") {
        // The site updated a price we've already wrapped (e.g. total spend recalculated)
        const w = mu.target.parentElement && mu.target.parentElement.closest(".rsi-aud-wrap:not(.rsi-aud-label)");
        if (w && mu.target.parentElement.closest(".rsi-aud-usd")) refreshWrapFromText(w);
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

  scan(document.body);
  requestRate();
})();
