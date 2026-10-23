# RSI AUDifier

A small Chrome extension for the [Roberts Space Industries](https://robertsspaceindustries.com) store.
Hover over a USD price and it swipes up and away, replaced by the price in AUD at the current exchange rate.
Move the mouse away and it returns to USD.

## Compatibility
- Roberts Space Industries store and account pages (`robertsspaceindustries.com`)
- **Star Citizen Hangar XPLORer** – the "Total Spend" figure (e.g. `686.40 USD`) also swaps to AUD on hover

## Install (development)
1. Clone or download this repo.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Visit the RSI store and hover over a price.

## How it works
- `content.js` finds price text (e.g. `$45.00 USD`) and wraps it in a two-layer element; `content.css` handles the slide animation.
- `background.js` fetches the USD→AUD rate (open.er-api.com, falling back to frankfurter.app), caches it for an hour and refreshes it hourly.
- Rates are mid-market reference rates (not Google's), updated by the providers about daily. Your card's actual charge will differ (fees, bank rate).

## Disclaimer
Unofficial fan project, not affiliated with Cloud Imperium Games or Roberts Space Industries.

## License
MIT
