// Theme presets. Shared by the popup (to draw the swatches) and by theme.js (the content script).
// A theme shifts RSI's blue palette to another hue; "sat" scales how colourful it is.
const UTILIFY_BASE_HUE = 210; // the hue of RSI's default blue

const UTILIFY_THEMES = [
  { id: "default",  name: "RSI Blue", hue: 210, sat: 1 },
  { id: "teal",     name: "Teal",     hue: 180, sat: 1 },
  { id: "emerald",  name: "Emerald",  hue: 148, sat: 0.9 },
  { id: "amber",    name: "Amber",    hue: 38,  sat: 1 },
  { id: "crimson",  name: "Crimson",  hue: 352, sat: 1 },
  { id: "magenta",  name: "Magenta",  hue: 315, sat: 0.9 },
  { id: "violet",   name: "Violet",   hue: 268, sat: 0.95 },
  { id: "graphite", name: "Graphite", hue: 210, sat: 0.05 },
];

function utilifyNormalizeTheme(t) {
  if (!t || typeof t.hue !== "number") return { id: "default", hue: UTILIFY_BASE_HUE, sat: 1 };
  const hue = ((Math.round(t.hue) % 360) + 360) % 360;
  const sat = Math.min(1.5, Math.max(0, typeof t.sat === "number" ? t.sat : 1));
  return { id: t.id || "custom", hue, sat };
}

function utilifyThemeIsDefault(t) {
  const n = utilifyNormalizeTheme(t);
  return n.hue === UTILIFY_BASE_HUE && Math.abs(n.sat - 1) < 0.005;
}

// A colour for the popup's swatch buttons
function utilifySwatchColor(t) {
  const n = utilifyNormalizeTheme(t);
  return "hsl(" + n.hue + " " + Math.round(Math.min(100, 70 * n.sat)) + "% 48%)";
}
