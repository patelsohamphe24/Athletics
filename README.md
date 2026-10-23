# IIT (BHU) Athletics Website

A full-stack athletics website with the public pages, password-only admin login, Express backend, SQLite persistence, Excel import/export, and optional Google Sheets / OneDrive integrations. The public website and API are served from the **same Render URL**, so the admin page only needs the password—there is no backend URL field.

## Deploy (recommended: one Render service)

1. Extract this ZIP and upload the contents of this folder to a GitHub repository.
2. In Render, choose **New → Blueprint** and connect that repository. Render reads `render.yaml` and builds the website and backend together.
3. Wait until the service is Live. Open the Render service URL (not GitHub Pages).
4. Check `https://YOUR-SERVICE.onrender.com/api/health`. It should return JSON with `"ok":true`.
5. Open the same Render service URL, click **Admin**, and enter the admin password.

The default password is `iitbhu11`, as requested. Change `ADMIN_PASSWORD` in Render before making the site public. Render creates a `SESSION_SECRET` and mounts a persistent disk for the SQLite database. Do not delete or regenerate `SESSION_SECRET` after configuring integrations.

## Run locally (easiest: double-click start.bat / start.command, see OPEN-ME-FIRST.txt)

Install Node.js 20+, run `npm install`, set `ADMIN_PASSWORD` and a `SESSION_SECRET` of at least 32 characters, then run `npm start` and open `http://localhost:3000`.

## Google Sheets (optional)

The Google Sheets two-way sync code remains included. To activate it, deploy `google-apps-script.gs` from the spreadsheet's **Extensions → Apps Script**, then add `GOOGLE_SHEETS_WEBAPP_URL` and `GOOGLE_SHEETS_TOKEN` in Render. Follow `GOOGLE_SHEETS_SETUP.md`. Back up the sheet before the first sync. Without these two settings, the site and admin login still work normally; Google Sheets status will say not configured.

## Important

Do not use GitHub Pages to host this full-stack version: GitHub Pages cannot run the Express API or database. GitHub is for storing the code; Render runs the website and backend together. The sample athletics records should be reviewed and replaced with official data before publication.

## Troubleshooting: "Cannot reach the backend"

This means the browser could not contact the Node server. Check:
1. You must open the **Render service URL** (or `http://localhost:3000` after `npm start`) - not the `index.html` file directly and not GitHub Pages.
2. Open `<your-url>/api/health` - it must show `{"ok":true,...}`. On Render's free/starter tiers the service can take ~1 minute to wake up.
3. If you really must host the pages elsewhere (e.g. GitHub Pages), edit `public/config.js` and set `window.API_BASE = 'https://your-service.onrender.com'`, and set `FRONTEND_ORIGIN` on Render to that site's origin (e.g. `https://username.github.io`).
