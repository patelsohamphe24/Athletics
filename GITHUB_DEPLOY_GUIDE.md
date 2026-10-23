# Simple deployment: GitHub + Render

This full-stack website uses Node.js, Express, SQLite and a secure admin session. **Deploy the frontend and backend together on Render.** Do not use GitHub Pages as the live site; GitHub Pages cannot run the backend.

1. Create a GitHub repository.
2. Upload the contents of this folder to the repository root (including `render.yaml`, `Dockerfile`, `package.json`, `server.js`, `seed.json`, and `public/`).
3. In Render, choose **New → Blueprint** and connect the repository.
4. Accept the blueprint settings and deploy.
5. Open the Render service URL plus `/api/health`. The JSON should include `"ok":true`.
6. Open the base Render service URL. Click **Admin** and enter the password. No backend URL is needed because the website and API share one origin.

## Admin password

The blueprint starts with `ADMIN_PASSWORD=iitbhu11` as requested. Change it in Render's Environment settings before sharing the public website. The environment variable is the source of truth and the password hash is refreshed on each restart.

## Persistent data

The blueprint mounts a persistent disk at `/app/data`, where SQLite stores website edits. Do not remove the disk. After logging in, change a harmless test field, refresh the page, and confirm the change remains saved.

## Google Sheets (optional)

To enable the optional two-way sync, follow `GOOGLE_SHEETS_SETUP.md`, then set `GOOGLE_SHEETS_WEBAPP_URL` and `GOOGLE_SHEETS_TOKEN` in Render. Back up your spreadsheet before initial synchronization. The website itself does not require Google Sheets credentials to run.

See `DEPLOY-QUICKSTART.md` for the short checklist.
