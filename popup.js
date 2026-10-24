const toggle = document.getElementById("permanent");
const rateEl = document.getElementById("rate");
document.getElementById("version").textContent = "Version " + chrome.runtime.getManifest().version;

function clock(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) + ", " + time;
}

function showRate(rate, updated) {
  rateEl.textContent = rate
    ? "1 USD = " + rate.toFixed(4) + " AUD" + (updated ? " · updated at " + clock(updated) : "")
    : "Exchange rate unavailable. Check your connection.";
}

chrome.storage.local.get(["permanent", "rate", "updated"]).then(async (s) => {
  toggle.checked = !!s.permanent;
  showRate(s.rate, s.updated);
  if (!s.rate) { // first run: ask the background script to fetch one
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRate" });
      if (res && res.rate) {
        const { updated } = await chrome.storage.local.get("updated");
        showRate(res.rate, updated || Date.now());
      }
    } catch (_) {}
  }
});

toggle.addEventListener("change", () => chrome.storage.local.set({ permanent: toggle.checked }));
