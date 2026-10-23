# Track Edition changes

- Replaced the Earth/planet concept with an animated, responsive oval running track.
- Added moving lane dashes, start/finish marks, glowing red/cyan motes and subtle dust.
- Applied a dark navy palette, translucent panels, restrained blur, and hover transitions.
- Honors `prefers-reduced-motion`; background animation stops for users who request reduced motion.
- Preserved the original portal markup, data-driven sections, admin UI, Express/SQLite API, Excel workbook and deployment configuration.

The animation is a custom Canvas implementation rather than an exact 250,000-point Three.js engine port.


## Updated mobile and visual pass
- Replaced the simple oval-only background with a branching particle-coral nebula using cyan and violet glow, plus an animated luminous running-track oval instead of a planet.
- Added mobile-first layout overrides for header/navigation, cards, tables, forms, and touch targets.
- `.env.example` now uses the requested admin password `iitbhu11`. Set the same environment variable in Render; changing the example file alone does not update a deployed service.
- The canvas is a self-contained approximation, not a pixel-exact Three.js 250,000-point port.
- Google Sheets bidirectional sync is pending the user's sheet URL and sharing/API setup; the current integration is Microsoft Excel/OneDrive and is not Google Sheets.


## Google Sheets integration status
The Google Sheets spreadsheet URL has not yet been supplied, so no live spreadsheet is connected in this package. The current backend supports persistent website state and Excel import/export plus optional OneDrive workbook sync. Once the Google Sheet link is supplied, configure a Google Apps Script/API integration with edit permissions and map the sheet tabs to the website data sections; do not publish service-account secrets in the frontend or GitHub. A true two-way integration needs authenticated write access and a defined conflict policy.

## Admin password
The Render Blueprint now sets `ADMIN_PASSWORD` to `iitbhu11` as requested. This is a short password; use it only as a temporary setup password and change it before exposing the admin console publicly.

## Mobile navigation
On phone-sized screens, the site uses a compact fixed bottom navigation with safe-area spacing, horizontally scrollable destinations, and larger touch targets.
