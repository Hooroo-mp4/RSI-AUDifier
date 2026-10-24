// Fetches and caches the USD -> AUD rate. Content scripts ask us for it
// because the page's own CORS rules would block them from calling the API.

const TTL_MS = 60 * 60 * 1000; // treat a rate as fresh for 1 hour

async function fetchFreshRate() {
  // Primary source
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json.result === "success" && json.rates && json.rates.AUD) return json.rates.AUD;
  } catch (_) {}
  // Fallback source (ECB reference rates)
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=AUD");
    const json = await res.json();
    if (json.rates && json.rates.AUD) return json.rates.AUD;
  } catch (_) {}
  return null;
}

async function getRate(force = false) {
  const { rate, updated } = await chrome.storage.local.get(["rate", "updated"]);
  if (!force && rate && Date.now() - updated < TTL_MS) return rate;
  const fresh = await fetchFreshRate();
  if (fresh) {
    await chrome.storage.local.set({ rate: fresh, updated: Date.now() });
    return fresh;
  }
  return rate ?? null; // fall back to a stale rate rather than nothing
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getRate") {
    getRate().then((rate) => sendResponse({ rate }));
    return true; // keep the channel open for the async response
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create("refresh-rate", { periodInMinutes: 60 });
  getRate(true);
  // Open the welcome tab on first install and after an update
  if (details.reason === "install" || details.reason === "update") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html?reason=" + details.reason) });
  }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("refresh-rate", { periodInMinutes: 60 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh-rate") getRate(true);
});
