# Ticket Widget Demo

Static page for testing the Enviso ticketing widget on GitHub Pages (HTTPS).

## What this is

- Pure static files: `index.html`, `app.js`, `styles.css`
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
- This repository is prepared locally and not published by this setup step.

## Source docs

- https://help.vintia.com/enviso/developers/ticketing-widget/en/getting-started.html
- https://help.vintia.com/enviso/developers/ticketing-widget/en/pre-requisites-for-configuration.html
