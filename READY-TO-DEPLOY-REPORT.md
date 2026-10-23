# Ready-to-deploy changes and checks

## Changes in this package
- Simplified the admin login to a single password field.
- Removed the backend URL field and test-connection button from the login UI.
- All frontend API calls now use same-origin `/api/...` routes.
- Login reports a connection/backend-state error separately from an incorrect password.
- Login requires the server state to load successfully before opening the admin dashboard.
- Simplified Render Blueprint to deploy frontend and backend as one service, with SQLite persistent storage.
- Kept Google Sheets sync optional; it is not required for the website to start.

## Checks
- Server JavaScript syntax: checked with `node --check server.js`.
- Frontend inline JavaScript syntax: checked with `node --check`.
- Static smoke tests: run via `npm test`.
- ZIP integrity: checked after packaging.

## Not claimed as tested
The package cannot be confirmed live against your own Render account from this environment. After deploying, verify `/api/health`, sign in, edit a test field, refresh, and confirm persistence. A live Google Sheets sync also requires your Apps Script deployment and secret values.
