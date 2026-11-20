# Ticket Widget Demo

Static page for testing the Enviso ticketing widget on GitHub Pages (HTTPS).

## What this is

- Pure static files: `index.html`, `app.js`, `styles.css` (all-in-one) and `steps.html`, `steps.js`, `shop.css` (demo shop)
- Staging widget scripts from `widget.staging-enviso.io`
- Default API base: `https://api.staging-enviso.io/ticketwidgetapi/`
- No secrets in the repository
- No personal, company, or customer identifiers in this demo

## Required URL parameters

According to the official Getting started docs, the widget settings that matter are:

| Query param | Maps to | Required | Notes |
| --- | --- | --- | --- |
| `apikey` | `enviso.settings.apiKey` | yes | Widget API key |
| `salespoint` | `enviso.settings.salesPointId` | yes | Numeric sales point id |
| `offers` | `included-offer-ids` | no | Comma-separated offer ids |
| `offer` | `offer-id` | no | Single offer detail mode |
| `lang` | `enviso.settings.language` | no | ISO language code |
| `locale` | `enviso.settings.locale` | no | BCP-47 locale |
| `apiurl` | `enviso.settings.ticketingWidgetApi` | no | Defaults to staging ticketwidgetapi |
| `tenant` | — | no | Accepted for URL compatibility only. Not a documented widget setting in Getting started |

Example (placeholders only):

```text
https://<user>.github.io/<repo>/?apikey=YOUR_KEY&salespoint=YOUR_SALESPOINT&offers=OFFER_A,OFFER_B
```

Values are read from the query string at runtime and are not saved to browser storage, cookies, or log files by this demo.

## Demo shop (`steps.html`)

`steps.html` + `steps.js` + `shop.css` are a fictional demo ticket shop ("Demo Erlebniswelt") built from the
individual Enviso step components instead of the all-in-one widget. Same URL parameters
(`apikey`, `salespoint`, `offers`, `lang`, `locale`, `apiurl`); `lang`/`locale` default to `de`/`de-DE`.

Structure (hash routes):

- `#start` – header, hero, featured offers, "how it works", footer with demo placeholders
- `#tickets` – offer cards rendered from the ticketing widget API (`salespoints/{id}/offers`)
- `#buchen/{offerId}` – progress bar; `<enviso-ticket-selection-step>` then `<enviso-time-selection-step>`
  (skipped for offers with capacity "Total"); "In den Warenkorb" calls `POST {apiurl}reservations?salespointid=…`
  (same call the built-in ticket flow makes), then `enviso.basket.refresh()`
- `#warenkorb` – `<enviso-basket-overview>` plus own summary from `enviso.basket` (quantity +/−, remove, total, expiry)
- `#kasse` – `<enviso-basket-my-info>` → `<enviso-payment-step>` (creates the order when shown; mounted once after confirmation)
  → `<enviso-ticket-order-complete-step>`

Header mini-cart (drawer) with item badge, updated on the `enviso.basket` `change` event.
"Entwickler-Infos" switch toggles the "Was passiert hier?" boxes and the developer panel (event log with
event names and non-personal fields only).

Note: the widget itself keeps its basket session and the entered customer data in the browser's localStorage
(same as the all-in-one widget). This demo stores no keys.

## Widget-only shop (`shop.html`)

`shop.html` + `shop-simple.js` (+ `shop.css` for the page layout) show the same demo shop built **only from official,
documented widget elements**. Same URL parameters. No own API calls, no own offer cards, nothing written to storage by
the page script.

| Section | Element |
|---|---|
| Header login / visitor account | `<enviso-profile>` (official profile button: sign in, sign up, my orders / details / relations, sign out) |
| Header basket icon (with item count) | `<enviso-basket-button>` inside a plain link to `#warenkorb` |
| `#tickets` | `<enviso-offer-overview offer-type="ticket" included-offer-ids="[…]" sort-by-include-offer-ids>` |
| `#buchen` | `<enviso-ticket-flow offer-id="…">` (ticket selection, date/time slot, "add to basket" – all inside the element) |
| `#warenkorb` | `<enviso-basket-flow>` (order overview with edit/remove → my info → payment) and `<enviso-basket-expiry-countdown threshold="30">` |
| `#fertig` | `<enviso-ticket-order-complete-step>` |

`shop-simple.js` only: reads URL parameters into `window.enviso.settings` and loads the components; shows/hides
sections on hash change; on `buyticketsclick` creates `<enviso-ticket-flow>` with that `offer-id`; on
`ordercreated` / `paymentverified` / `paymentfailed` / `orderfailed` shows the order-complete element with the
matching attributes.

Limitations compared with `steps.html`: the ticket flow fires no documented "added to basket" event, so the page
does not switch to the basket by itself (the header icon counts up; the user clicks "Zum Warenkorb"); no own mini-cart
or drawer; offer cards and all forms use the widget's design (adjust via theme variables/CSS parts only).

Component paths: the docs list `basket/enviso-basket-expiry-countdown.js`; the staging CDN serves the bundle as
`basket/enviso-basket-expiry-countdown-element.js`. The profile button is documented at
`auth/enviso-profile-element.js` (same path on staging and production).

The official profile UI is a header button with a dropdown and dialogs, not a separate page. A custom `#konto`
section is therefore not used. On the all-in-one widget (`index.html`) the same feature is the `show-auth`
attribute on `<enviso-ticket-widget>`, plus `configuration-id` (URL parameter `config`, defaulting to the
staging “Demo Shop” configuration). `enviso-profile` and the other standalone shop elements do not accept
that attribute.

OAuth login/register uses `enviso.settings.fusionAuthClientId` from the staging widget `config/env.js`
(not from the widget-configuration API).

## Local preview

Any static file server works, for example:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Then open the page with query parameters. GitHub Pages is preferred for payment UI testing because the payment component expects HTTPS.

## Notes

- Use only staging credentials and test data.
- Origin allowlisting for the GitHub Pages host may still be required in Enviso Admin / Adyen, depending on tenant setup.
- A browser payment event alone is not proof of a successful payment; verify server-side.

## Source docs

- Official Enviso ticketing widget developer docs: "Getting started", "Pre-requisites for configuration", "Widget step components"

## Styled widget page (`widget-styled.html`)

`widget-styled.html` + `widget-styled.js` embed the all-in-one `<enviso-ticket-widget>` (staging) in a typical
production pattern:

- `window.enviso.settings` block first (apiKey/salespoint from URL, staging `ticketingWidgetApi`, `testPayment: true`,
  `language` from `<html lang>`; optional `adyenClientKey`, `fusionAuthClientId`, `fusionAuthClientRedirectUri` are
  set **only** if passed as URL parameters), then `loader.js` and the component bundles.
- A placeholder is replaced by `<enviso-ticket-widget>` with `show-prices`, `show-prices-type="highestUnit"`,
  `included-offer-ids`, `sort-by-include-offer-ids`, `preferred-dates`, optional `terms`/`privacy`, `newsletter`,
  plus `enviso-offer-overview image-click-action="tickets"`, `enviso-time-selection auto-select-visit-time` and the
  slots `below-basket-items` / `below-ticket-widget` (payment methods as plain text badges).
- Look & feel only via `<enviso-style for="…">` blocks (offer cards, ticket items, numeric up/down, buttons, calendar,
  timeslots, basket, discount field, form, dialog, Adyen payment) and `--enviso-*-color` variables. No shadow-DOM
  scripting, no internal APIs.

Open: `widget-styled.html?apikey=YOUR_KEY&salespoint=YOUR_SALESPOINT&offers=OFFER_A,OFFER_B[&lang=de]`

Image credits: `assets/hero.svg` is an original illustration made for this demo (no third-party assets).
Offer images inside the widget come from the Enviso offer configuration.

Local testing: serve the folder on `http://localhost:3000` (e.g. `python3 -m http.server 3000`). From that origin the
staging order and the Adyen test drop-in work; from `http://127.0.0.1:<port>` the `POST ticketwidgetapi/orders`
response is blocked (no CORS header), and other origins (e.g. GitHub Pages) need the Adyen origin to be allowed.
