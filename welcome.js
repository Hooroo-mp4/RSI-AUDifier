const params = new URLSearchParams(location.search);
document.getElementById("title").textContent =
  params.get("reason") === "update" ? "Thanks for updating!" : "Thanks for downloading!";
document.getElementById("version").textContent = chrome.runtime.getManifest().version;
