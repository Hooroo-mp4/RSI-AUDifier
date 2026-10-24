const $ = (id) => document.getElementById(id);
const EXCLUDED = new Set(["USD", "EUR", "GBP"]); // USD is the price currency on RSI; EUR and GBP are left out on purpose
$("version").textContent = "Version " + chrome.runtime.getManifest().version;

const state = { currency: "AUD", rates: null, updated: null, theme: utilifyNormalizeTheme(null) };
let items = [];       // [{ code, name, symbol }]
let shown = [];       // filtered items
let activeIdx = -1;

// ---------- helpers ----------
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function clock(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + time;
}

function buildItems() {
  let codes = state.rates ? Object.keys(state.rates) : [];
  if (!codes.length && Intl.supportedValuesOf) codes = Intl.supportedValuesOf("currency"); // offline fallback
  let names = null;
  try { names = new Intl.DisplayNames(["en"], { type: "currency" }); } catch (_) {}
  items = codes
    .filter((c) => /^[A-Z]{3}$/.test(c) && !EXCLUDED.has(c))
    .map((code) => {
      let name = code, symbol = "";
      try { name = names ? names.of(code) || code : code; } catch (_) {}
      try {
        const p = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0);
        symbol = (p.find((x) => x.type === "currency") || {}).value || "";
      } catch (_) {}
      return { code, name, symbol, hay: fold(code + " " + name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- currency picker ----------
function currentLabel() {
  const it = items.find((i) => i.code === state.currency);
  return it ? it.code + " – " + it.name : state.currency;
}

function renderList(query) {
  const q = fold((query || "").trim());
  shown = q ? items.filter((i) => i.hay.includes(q)) : items.slice();
  if (q) shown.sort((a, b) => (b.code.toLowerCase().startsWith(q) - a.code.toLowerCase().startsWith(q)));
  const list = $("curList");
  list.textContent = "";
  shown.forEach((it, idx) => {
    const li = document.createElement("li");
    li.role = "option";
    li.id = "cur-" + it.code;
    li.dataset.idx = idx;
    li.setAttribute("aria-selected", String(it.code === state.currency));
    li.innerHTML = '<span class="code"></span><span class="nm"></span><span class="sym"></span>';
    li.children[0].textContent = it.code;
    li.children[1].textContent = it.name;
    li.children[2].textContent = it.symbol;
    list.appendChild(li);
  });
  $("curEmpty").hidden = shown.length > 0;
  setActive(q ? 0 : shown.findIndex((i) => i.code === state.currency), !q);
}

function setActive(idx, scroll) {
  const list = $("curList");
  const prev = list.querySelector("li.active");
  if (prev) prev.classList.remove("active");
  activeIdx = Math.max(-1, Math.min(idx, shown.length - 1));
  const li = list.children[activeIdx];
  if (li) {
    li.classList.add("active");
    $("curSearch").setAttribute("aria-activedescendant", li.id);
    if (scroll !== false) li.scrollIntoView({ block: "nearest" });
  }
}

function openPanel() {
  $("curPanel").hidden = false;
  $("curBtn").setAttribute("aria-expanded", "true");
  $("curSearch").value = "";
  renderList("");
  $("curSearch").focus();
}
function closePanel(refocus) {
  $("curPanel").hidden = true;
  $("curBtn").setAttribute("aria-expanded", "false");
  if (refocus) $("curBtn").focus();
}

function chooseCurrency(code) {
  state.currency = code;
  $("curText").textContent = currentLabel();
  showRate();
  chrome.storage.local.set({ currency: code });
  closePanel(true);
}

function showRate() {
  const r = state.rates && state.rates[state.currency];
  $("rate").textContent = r
    ? "1 USD = " + (r >= 100 ? r.toFixed(2) : r.toFixed(4)) + " " + state.currency + (state.updated ? " · updated at " + clock(state.updated) : "")
    : "Exchange rate unavailable. Check your connection.";
}

$("curBtn").addEventListener("click", () => ($("curPanel").hidden ? openPanel() : closePanel(false)));
$("curSearch").addEventListener("input", (e) => renderList(e.target.value));
$("curSearch").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIdx + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIdx - 1); }
  else if (e.key === "Enter") { e.preventDefault(); if (shown[activeIdx]) chooseCurrency(shown[activeIdx].code); }
  else if (e.key === "Escape") { e.preventDefault(); closePanel(true); }
});
$("curList").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) chooseCurrency(shown[+li.dataset.idx].code);
});

// ---------- theme controls ----------
let saveTimer = null;
function saveTheme(immediate) {
  clearTimeout(saveTimer);
  const write = () => chrome.storage.local.set({ theme: state.theme });
  if (immediate) write(); else saveTimer = setTimeout(write, 120); // debounce while dragging a slider
}

const themeLabel = () => {
  const preset = UTILIFY_THEMES.find((p) => p.id === state.theme.id);
  return preset ? preset.name : "Custom theme";
};

function renderTheme() {
  const t = state.theme;
  $("hue").value = t.base.hue;
  $("accentHue").value = t.accent.hue;
  $("sat").value = Math.round(t.vibe * 100);
  $("sat").style.background = "linear-gradient(90deg,#555,hsl(" + t.accent.hue + " 80% 55%))";
  document.querySelectorAll(".swatch").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.id === t.id)));
  $("themeName").textContent = themeLabel();
}

function buildSwatches() {
  const wrap = $("swatches");
  UTILIFY_THEMES.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch"; b.dataset.id = p.id;
    b.role = "radio"; b.title = p.name; b.setAttribute("aria-label", p.name);
    const [surface, accent] = utilifySwatchColors(p);
    b.style.background = "linear-gradient(135deg," + surface + " 50%," + accent + " 50%)"; // surface colour / accent colour
    b.addEventListener("click", () => { state.theme = utilifyNormalizeTheme(p); renderTheme(); saveTheme(true); });
    b.addEventListener("mouseenter", () => { $("themeName").textContent = p.name; });
    b.addEventListener("mouseleave", () => { $("themeName").textContent = themeLabel(); });
    wrap.appendChild(b);
  });
}

// Moving a slider starts from the current theme and marks it custom. Greys have no hue to change,
// so touching a hue slider on a grey colour makes it colourful first.
function onSlider(which) {
  const t = utilifyNormalizeTheme(state.theme);
  t.id = "custom";
  if (which === "hue") { t.base.hue = +$("hue").value; if (t.base.sat < 0.5) t.base.sat = 0.9; }
  else if (which === "accent") { t.accent.hue = +$("accentHue").value; if (t.accent.sat < 0.5) t.accent.sat = 0.9; }
  else t.vibe = +$("sat").value / 100;
  state.theme = utilifyNormalizeTheme(t);
  renderTheme(); saveTheme(false);
}
$("hue").addEventListener("input", () => onSlider("hue"));
$("accentHue").addEventListener("input", () => onSlider("accent"));
$("sat").addEventListener("input", () => onSlider("sat"));

// ---------- start ----------
$("permanent").addEventListener("change", (e) => chrome.storage.local.set({ permanent: e.target.checked }));

(async function init() {
  buildSwatches();
  const s = await chrome.storage.local.get(["permanent", "currency", "rates", "updated", "theme"]);
  $("permanent").checked = !!s.permanent;
  state.currency = s.currency || "AUD";
  state.rates = s.rates || null;
  state.updated = s.updated || null;
  state.theme = utilifyNormalizeTheme(s.theme);
  buildItems();
  $("curText").textContent = currentLabel();
  showRate();
  renderTheme();

  if (!state.rates) { // first run: ask the background script to fetch rates
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRates" });
      if (res && res.rates) {
        const { updated } = await chrome.storage.local.get("updated");
        state.rates = res.rates; state.updated = updated || Date.now();
        buildItems(); $("curText").textContent = currentLabel(); showRate();
      }
    } catch (_) {}
  }
})();
