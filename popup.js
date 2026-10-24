const toggle = document.getElementById("permanent");
const rateEl = document.getElementById("rate");
document.getElementById("version").textContent = "Version " + chrome.runtime.getManifest().version;

function ago(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  const h = Math.round(mins / 60);
  return h + (h === 1 ? " hour ago" : " hours ago");
}

function showRate(rate, updated) {
  rateEl.textContent = rate
    ? "1 USD = " + rate.toFixed(4) + " AUD" + (updated ? " · updated " + ago(updated) : "")
    : "Exchange rate unavailable. Check your connection.";
}

chrome.storage.local.get(["permanent", "rate", "updated"]).then(async (s) => {
  toggle.checked = !!s.permanent;
  showRate(s.rate, s.updated);
  if (!s.rate) { // first run: ask the background script to fetch one
    try {
      const res = await chrome.runtime.sendMessage({ type: "getRate" });
      if (res && res.rate) showRate(res.rate, Date.now());
    } catch (_) {}
  }
});

toggle.addEventListener("change", () => chrome.storage.local.set({ permanent: toggle.checked }));
