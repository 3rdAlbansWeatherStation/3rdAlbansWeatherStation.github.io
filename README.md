# Public website (`site/`) — GitHub Pages only

**Different site from the Pi kiosk.** The Pi uses `public/` + Express; this folder is only for
[https://3rdalbansweatherstation.github.io/](https://3rdalbansweatherstation.github.io/).

Same Scouts look when we choose to match it; **no Power controls**. Never deploy this folder to the Pi.

## Data (safe by design)

- Loads only `./data/*.json` (weather readings for display).
- **Never** put Ecowitt API keys, hub passwords, Wi‑Fi keys, or the Scout Hut credentials document in this folder.
- Live data: GitHub Action on **`3rdAlbansWeatherStation.github.io`** runs `.github/scripts/fetch-ecowitt-data.js` every **15 minutes** (and on manual dispatch), using repository **Actions secrets**:
  - `ECOWITT_APPLICATION_KEY`
  - `ECOWITT_API_KEY`
  - `ECOWITT_DEVICE_MAC`
- Keys stay in GitHub Secrets only — not in this folder or committed JSON.

Local regenerate (uses your gitignored `.env` — Windows PowerShell):

```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }; $p=$_.Split('=',2); Set-Item "env:$($p[0].Trim())" $p[1].Trim() }
$env:SITE_DATA_DIR = "$PWD\site\data"
node site/.github/scripts/fetch-ecowitt-data.js
```

Publish this folder to Pages: `python scripts/publish-github-site.py`

Demo mock (no keys): `node scripts/export-site-mock.js`

## Preview locally

```bash
npx --yes serve site
```

## Live URL

Published from repo **`3rdAlbansWeatherStation.github.io`** (user/org Pages at the root).  
This `site/` folder is the source copy in `pi-weather`; publish copies it to that Pages repo (including `.github/` for the weather Action).

## Cache busting

After style or script changes, bump the `?v=` query on the links in `index.html`.
