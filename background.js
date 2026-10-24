// Utilify background script.
// Fetches and caches USD exchange rates (for every currency) and opens the welcome tab.
// Content scripts ask us for rates because the page's own CORS rules would block them from calling the API.

const TTL_MS = 60 * 60 * 1000; // treat rates as fresh for 1 hour

async function fetchFreshRates() {
  // Primary source: every currency, updated about daily
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json.result === "success" && json.rates && json.rates.AUD) return json.rates;
  } catch (_) {}
  // Fallback source (ECB reference rates, about 30 major currencies)
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD");
    const json = await res.json();
    if (json.rates) return { USD: 1, ...json.rates };
  } catch (_) {}
  return null;
}

async function getRates(force = false) {
  const { rates, updated } = await chrome.storage.local.get(["rates", "updated"]);
  if (!force && rates && Date.now() - updated < TTL_MS) return rates;
  const fresh = await fetchFreshRates();
  if (fresh) {
    const merged = { ...(rates || {}), ...fresh }; // keep older rates for anything the fallback source lacks
    await chrome.storage.local.set({ rates: merged, updated: Date.now() });
    return merged;
  }
  return rates ?? null; // fall back to stale rates rather than nothing
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getRates") {
    getRates().then((rates) => sendResponse({ rates }));
    return true; // keep the channel open for the async response
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create("refresh-rates", { periodInMinutes: 60 });
  getRates(true);
  // Open the welcome tab on first install and after an update
  if (details.reason === "install" || details.reason === "update") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html?reason=" + details.reason) });
  }
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("refresh-rates", { periodInMinutes: 60 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh-rates") getRates(true);
});
