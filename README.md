# Utilify

A small browser extension with handy tools for the [Roberts Space Industries](https://robertsspaceindustries.com) website.

> Unofficial fan project. Not affiliated with Cloud Imperium Games or Roberts Space Industries.

## Features

### Currency converter
- Hover over a USD price and it swipes up and away, replaced by the price in **your currency** at the current exchange rate. Move the mouse away and it slides back to USD.
- The `USD` label flips to your currency code too, and a crossed-out old price flips along with the current price.
- Pick **any currency** from a searchable list (default: AUD). USD, EUR and GBP are not offered.
- Optional **Always show converted prices** mode: every price is converted without hovering (hover one to peek at the USD).

### Website themes
- Recolour RSI's blue with one click: RSI Blue (default), Teal, Emerald, Amber, Crimson, Magenta, Violet or Graphite.
- Or make your own with the **Hue** and **Colourfulness** sliders.
- Only RSI's blues change. Sale prices, errors and the orange checkout buttons keep their colours.
- Changes apply instantly to every open RSI tab.

### Also
- Works with **Star Citizen Hangar XPLORer**: the "Total Spend" figure (e.g. `686.40 USD`) converts on hover too.
- No accounts, no tracking, no data collected (see [PRIVACY.md](PRIVACY.md)).

## Compatibility
| Browser | Supported |
|---|---|
| Google Chrome | ✅ |
| Opera / Opera GX | ✅ |
| Microsoft Edge | ✅ |
| Brave | ✅ |
| Firefox | ❌ not supported |

---

## Installation (manual / developer mode)

Until Utilify is on a browser store, you install it by loading the folder yourself. It takes about a minute.

### Step 1: Download
1. On this GitHub page click the green **Code** button, then **Download ZIP**.
   (Or download `Utilify.zip` from the Releases page.)
2. Save it somewhere you'll remember, like your Downloads folder.

### Step 2: Unzip it
**Windows**
1. Find the `.zip` file in File Explorer.
2. Right-click it and choose **Extract All...**
3. Click **Extract**. A normal folder appears next to the zip.

**Mac**
1. Double-click the `.zip` file. A folder appears next to it.

### Step 3: Put the folder somewhere permanent
The browser reads the extension from this folder **every time it starts**, so don't delete or move it afterwards. A good spot is `Documents` or `C:\Users\YourName\Extensions`.

### Step 4: Find the right folder
Open the unzipped folder. You should see these files inside:

```
manifest.json
background.js
currency.js
theme.js
popup.html
icons/
README.md
...
```

The folder that **directly contains `manifest.json`** is the one you need. Sometimes unzipping creates a folder inside a folder (for example `Utilify` → `Utilify`). If you open the first one and see only another folder, that inner one is the right one.

### Step 5: Load it into your browser
Pick your browser below.

#### Google Chrome
1. Type `chrome://extensions` into the address bar and press Enter.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left).
4. In the window that opens, **click the folder once to highlight it. Don't double-click it.** Make sure it's the folder that contains `manifest.json`.
5. Click **Select Folder** (Windows) or **Select** (Mac).

#### Opera / Opera GX
1. Type `opera://extensions` into the address bar and press Enter.
   (Or: click the Opera menu in the top-left, then **Extensions**, then **Manage Extensions**. The shortcut is `Ctrl + Shift + E`.)
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. **Click the folder once to highlight it. Don't double-click it.** Choose the folder that contains `manifest.json`.
5. Click **Select Folder**.

#### Microsoft Edge
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (left sidebar).
3. Click **Load unpacked**, click the folder once to highlight it, then **Select Folder**.

#### Brave
1. Go to `brave://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**, click the folder once to highlight it, then **Select**.

### Step 6: Check it worked
- A **welcome tab** should open saying "Thanks for downloading!" and showing your version number.
- **Utilify** should appear in your extensions list, switched **on**.
- Click the Utilify icon (pin it from the puzzle-piece / cube menu) to open the settings menu.
- Open any RSI store page, for example the [First Flight Pack](https://robertsspaceindustries.com/en/pledge/Packages/Star-Citizen-First-Flight-Pack), and **hover over a price**. It should swipe up and show the converted amount.

> If you had an RSI page open while installing, refresh it (`F5`) once.

---

## Settings
Click the **Utilify icon** in your browser toolbar. If you can't see it, open the puzzle-piece icon in Chrome/Edge/Brave or the cube icon in Opera and pin it.

| Setting | What it does |
|---|---|
| **Always show converted prices** | Converts every price on the page without hovering. Hover a price to peek at the original USD. |
| **Convert prices to** | Pick your currency. Type in the search box to filter (try `yen`, `CAD` or `swiss`). Defaults to AUD. |
| **Website theme** | Pick a preset colour, or drag **Hue** / **Colourfulness** to make your own. Choose the first (blue) swatch to go back to RSI's normal look. |

The menu also shows the exchange rate in use and the time it was last fetched.

## Where to find the extension afterwards

| Browser | How to open the extensions list |
|---|---|
| Chrome | `chrome://extensions`, or the puzzle-piece icon in the toolbar, then **Manage extensions** |
| Opera / Opera GX | `opera://extensions`, or `Ctrl + Shift + E`, or the cube icon in the toolbar / sidebar |
| Edge | `edge://extensions` |
| Brave | `brave://extensions` |

From there you can switch it off or on, or remove it.

## Updating
1. Download and unzip the new version.
2. Replace the old files in your folder with the new ones (or point **Load unpacked** at the new folder after removing the old one).
3. Open your browser's extensions page and click the **reload** icon (circular arrow) on Utilify.
4. Refresh any open RSI tabs.

(Reloading an unpacked extension also opens the welcome tab again. That's normal.)

## Troubleshooting

| Problem | Fix |
|---|---|
| **"Manifest file is missing or unreadable"** | You selected the wrong folder. Select the one that directly contains `manifest.json` (see Step 4). |
| **I don't see a "Load unpacked" button** | Turn on **Developer mode** first. |
| **Extension disappeared after restarting the browser or moving a folder** | The browser lost the folder. Don't move or delete it after loading. Load it again from its location. |
| **I can't find the settings menu** | Pin the extension: click the puzzle-piece icon (cube icon in Opera) and pin **Utilify**. |
| **Prices don't swap when I hover** | Refresh the RSI page. Check the extension is switched on. |
| **Price shows "…"** | The exchange rate hasn't loaded. Check your internet connection, then refresh. |
| **My currency isn't in the list** | The list comes from the live exchange-rate provider, so a few very obscure currencies may be missing. USD, EUR and GBP are left out on purpose. |
| **Theme doesn't change everything** | Utilify recolours RSI's blue palette, so some images, videos and a few older pages with their own styling may stay as they are. Open an issue with a screenshot and the page link. |
| **Page flashes blue for a moment after changing theme** | Only the very first load after picking a new theme. It's remembered after that. |
| **Opera shows a warning about developer-mode extensions** | This is normal for extensions loaded manually. |
| **A price on the site isn't converting** | Open an issue (see below) and include a screenshot and the page link. |

## How it works
- `currency.js` finds price text (such as `$49.50 USD` or `686.40 USD`), wraps it in a two-layer element and pairs it with the separate `USD` label. `currency.css` handles the slide animation.
- `theme.js` reads RSI's own stylesheets, finds every blue colour and writes override rules with the hue shifted. `themes.js` holds the presets.
- `background.js` fetches USD exchange rates for every currency from open.er-api.com (with frankfurter.app as a fallback), caches them for an hour and refreshes them hourly.
- `popup.html` / `popup.js` is the settings menu and `welcome.html` is the tab shown after install/update.
- Rates are mid-market reference rates updated by the providers about once a day. Your card or PayPal's actual charge will differ because of bank fees and their own exchange margin. Treat converted prices as a guide.

## Reporting problems
Open an issue on this GitHub repo with:
- the page link
- a screenshot
- your browser and version

## Contributing
Pull requests are welcome. To work on it, load the folder as above, edit the files, then click the reload icon on the extensions page to see your changes.

## License
MIT, see [LICENSE](LICENSE).
