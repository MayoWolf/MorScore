# MorScore

MorScore is a small Netlify-ready web app for FRC California district scouting.
It lets you choose a California district event and then shows:

- The teams attending that event
- Each team's California district rank
- The team's previous California event that season
- The team's finish at that previous California event as `rank / total teams`

The app uses a Netlify Function to call The Blue Alliance API so your auth key stays server-side.

## Project Layout

- [`public/index.html`](/Users/wolfnazari/MorScore/public/index.html)
- [`public/app.js`](/Users/wolfnazari/MorScore/public/app.js)
- [`public/styles.css`](/Users/wolfnazari/MorScore/public/styles.css)
- [`netlify/functions/tba.js`](/Users/wolfnazari/MorScore/netlify/functions/tba.js)
- [`netlify.toml`](/Users/wolfnazari/MorScore/netlify.toml)

## TBA Setup

1. Create a read API key in The Blue Alliance developer settings.
2. In Netlify, add an environment variable named `TBA_AUTH_KEY`.
3. Redeploy after saving the variable.

The function sends that key as the `X-TBA-Auth-Key` header to the TBA v3 API.

## Netlify Settings

This repo already includes [`netlify.toml`](/Users/wolfnazari/MorScore/netlify.toml), so Netlify should pick up:

- Publish directory: `public`
- Functions directory: `netlify/functions`

There is also a redirect so the frontend can call `/api/tba?...` instead of the raw function path.

## Local Check

Run:

```bash
npm run check
```

That verifies the frontend and function JavaScript syntax.
