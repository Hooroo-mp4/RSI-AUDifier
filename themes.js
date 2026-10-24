// Theme presets, based on the in-game manufacturers. Shared by the popup (to draw the swatches)
// and by theme.js (the content script).
//
// RSI's palette has two blues: a dark "base" ramp used for backgrounds and panels, and a bright
// "accent" blue used for buttons and links. A theme sets each separately:
//   hue  - the colour (0-359)
//   sat  - how colourful it is (0 = grey, 1 = as colourful as RSI's blue)
//   lum  - brightness multiplier (below 1 = darker, above 1 = lighter)
const UTILIFY_BASE_HUE = 205;   // hue of RSI's dark blue surfaces
const UTILIFY_ACCENT_HUE = 207; // hue of RSI's bright accent blue

const UTILIFY_THEMES = [
  { id: "default",  name: "Roberts Space Industries", base: { hue: 205, sat: 1,    lum: 1    }, accent: { hue: 207, sat: 1,    lum: 1    } },
  { id: "aegis",    name: "Aegis Dynamics",           base: { hue: 205, sat: 0.04, lum: 1.3  }, accent: { hue: 356, sat: 0.85, lum: 0.85 } },
  { id: "anvil",    name: "Anvil Aerospace",          base: { hue: 62,  sat: 0.28, lum: 1.05 }, accent: { hue: 46,  sat: 0.9,  lum: 0.95 } },
  { id: "aopoa",    name: "Aopoa",                    base: { hue: 150, sat: 0.06, lum: 0.8  }, accent: { hue: 78,  sat: 0.75, lum: 0.95 } },
  { id: "argo",     name: "Argo Astronautics",        base: { hue: 195, sat: 0.06, lum: 1.1  }, accent: { hue: 16,  sat: 0.95, lum: 0.95 } },
  { id: "banu",     name: "Banu",                     base: { hue: 192, sat: 1.15, lum: 0.95 }, accent: { hue: 178, sat: 0.9,  lum: 1    } },
  { id: "cnou",     name: "Consolidated Outland",     base: { hue: 205, sat: 0,    lum: 0.55 }, accent: { hue: 0,   sat: 0,    lum: 1.35 } },
  { id: "crusader", name: "Crusader Industries",      base: { hue: 215, sat: 1,    lum: 1.15 }, accent: { hue: 215, sat: 0.45, lum: 1.25 } },
  { id: "drake",    name: "Drake Interplanetary",     base: { hue: 205, sat: 0,    lum: 0.6  }, accent: { hue: 46,  sat: 1,    lum: 0.95 } },
  { id: "esperia",  name: "Esperia",                  base: { hue: 0,   sat: 0.05, lum: 0.8  }, accent: { hue: 2,   sat: 0.9,  lum: 0.85 } },
  { id: "gatac",    name: "Gatac Manufacture",        base: { hue: 272, sat: 0.22, lum: 0.85 }, accent: { hue: 284, sat: 0.75, lum: 1    } },
  { id: "greys",    name: "Grey's Market",            base: { hue: 205, sat: 0.07, lum: 1    }, accent: { hue: 200, sat: 0.1,  lum: 1.25 } },
  { id: "greycat",  name: "Greycat Industrial",       base: { hue: 30,  sat: 0.05, lum: 1    }, accent: { hue: 40,  sat: 1,    lum: 0.95 } },
  { id: "kruger",   name: "Kruger Intergalactic",     base: { hue: 38,  sat: 0.35, lum: 0.85 }, accent: { hue: 40,  sat: 0.4,  lum: 1.15 } },
  { id: "mirai",    name: "Mirai",                    base: { hue: 205, sat: 0.3,  lum: 1    }, accent: { hue: 354, sat: 0.85, lum: 0.9  } },
  { id: "misc",     name: "MISC",                     base: { hue: 205, sat: 0.22, lum: 1.5  }, accent: { hue: 205, sat: 0.5,  lum: 1.2  } },
  { id: "origin",   name: "Origin Jumpworks",         base: { hue: 0,   sat: 0,    lum: 1.5  }, accent: { hue: 45,  sat: 0.15, lum: 1.3  } },
  { id: "tumbril",  name: "Tumbril Land Systems",     base: { hue: 35,  sat: 0.3,  lum: 1.15 }, accent: { hue: 26,  sat: 0.95, lum: 0.95 } },
];

const _utilClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const _utilRole = (r, def) => ({
  hue: ((Math.round(typeof r.hue === "number" ? r.hue : def.hue) % 360) + 360) % 360,
  sat: _utilClamp(typeof r.sat === "number" ? r.sat : 1, 0, 1.5),
  lum: _utilClamp(typeof r.lum === "number" ? r.lum : 1, 0.3, 2),
});

// Accepts anything stored in the past and returns { id, base, accent, vibe }
function utilifyNormalizeTheme(t) {
  const def = UTILIFY_THEMES[0];
  if (!t || typeof t !== "object") return { id: "default", base: { ...def.base }, accent: { ...def.accent }, vibe: 1 };
  if (!t.base && typeof t.hue === "number") { // older single-colour format: { hue, sat }
    const r = { hue: t.hue, sat: t.sat, lum: 1 };
    return { id: t.id || "custom", base: _utilRole(r, def.base), accent: _utilRole(r, def.accent), vibe: 1 };
  }
  return {
    id: t.id || "custom",
    base: _utilRole(t.base || {}, def.base),
    accent: _utilRole(t.accent || {}, def.accent),
    vibe: _utilClamp(typeof t.vibe === "number" ? t.vibe : 1, 0, 1.5),
  };
}

function utilifyThemeIsDefault(t) {
  const n = utilifyNormalizeTheme(t), d = UTILIFY_THEMES[0];
  const same = (a, b) => a.hue === b.hue && Math.abs(a.sat - b.sat) < 0.005 && Math.abs(a.lum - b.lum) < 0.005;
  return same(n.base, d.base) && same(n.accent, d.accent) && Math.abs(n.vibe - 1) < 0.005;
}

// Two colours for the popup's swatch buttons: [surface colour, accent colour]
function utilifySwatchColors(t) {
  const n = utilifyNormalizeTheme(t);
  const surface = "hsl(" + n.base.hue + " " + Math.round(_utilClamp(55 * n.base.sat, 0, 100)) + "% " + Math.round(_utilClamp(26 * n.base.lum, 6, 70)) + "%)";
  const accent = "hsl(" + n.accent.hue + " " + Math.round(_utilClamp(85 * n.accent.sat, 0, 100)) + "% " + Math.round(_utilClamp(58 * n.accent.lum, 20, 92)) + "%)";
  return [surface, accent];
}
