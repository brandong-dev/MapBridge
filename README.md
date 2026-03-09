# MapBridge

Simple static redirect page that sends users to directions in the map app best suited for their device. Built to host on GitHub Pages.

## URL formats

- Default destination (hardcoded in `index.html`):
  - `https://<username>.github.io/<repo>/`
- Destination by address/query:
  - `https://<username>.github.io/<repo>/?q=74192+Q+Rd,+Holdrege,+NE+68949`
- Destination by name + address/query:
  - `https://<username>.github.io/<repo>/?name=Gardens+on+Q&q=74192+Q+Rd,+Holdrege,+NE+68949`
- Destination by coordinates:
  - `https://<username>.github.io/<repo>/?lat=40.43011&lng=-99.38822&name=Gardens+on+Q`

Supported parameters:

- `q`: Address or place text query
- `name`: Display name for the destination
- `lat`: Latitude (number)
- `lng`: Longitude (number)

## Routing behavior

- iOS/iPadOS: redirects to Apple Maps
- Android: attempts `geo:` URI first, then falls back to Google Maps
- Desktop/other: redirects to Google Maps

## GitHub Pages deployment

This repo includes a workflow at `.github/workflows/pages.yml` that deploys on push to `main`.

1. Push this repository to GitHub.
2. In GitHub, open `Settings -> Pages`.
3. Under source/build, select `GitHub Actions`.
4. Push to `main` (or rerun the workflow) to publish.

Your site will be available at:

- `https://<username>.github.io/<repo>/`
