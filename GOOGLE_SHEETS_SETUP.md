# Google Sheets two-way sync setup

Target spreadsheet: https://docs.google.com/spreadsheets/d/1ZcpDbdYuA-MgUfAervLSqJWoiX0bCK5mQhVxDNoQRv0/edit

This project includes the server endpoints and an Apps Script bridge. The bridge is needed because the website server must not put Google credentials in browser code. Once configured:

- Admin-panel changes are pushed to the sheet after the server saves them.
- Manual edits in the editable tabs are detected by Apps Script and imported by the website server about every 30 seconds.
- Public pages refresh server state about every 15 seconds.
- A hidden `State Backup` tab stores the complete website JSON in chunks, including fields not suited to normal spreadsheet cells and uploaded image data. Do not edit that tab manually.
- The bridge uses a shared secret token. Keep it private and never commit the actual token to GitHub.

## 1. Add the bridge to your spreadsheet

1. Open the spreadsheet link above while signed in to the Google account that owns or can edit the sheet.
2. Open **Extensions → Apps Script**.
3. Open the `google-apps-script.gs` file from this ZIP, copy all its contents into the Apps Script editor, replacing the starter code.
4. Replace `REPLACE_WITH_A_LONG_RANDOM_SECRET_AT_LEAST_32_CHARACTERS` in the `SYNC_TOKEN` line with a long random secret. Make a copy of that exact secret for the server environment; do not share it publicly.
5. Save the project. Optionally run `setupSyncBridge` once from the editor and approve the Google permission prompt.
6. Choose **Deploy → New deployment → Web app**.
7. Set **Execute as** to **Me**. Set access to **Anyone** so the backend can call it; the shared secret is required for every API call.
8. Click **Deploy**, authorize if asked, and copy the Web app URL ending in `/exec`.

**Back up the spreadsheet before connecting.** The first admin-to-sheet push writes the website's current data into the integration tabs and can replace their rows. If the spreadsheet already has athletics tabs with older or different headers, the integration stops without syncing; make a copy first, then align the tab headers with the exact latest list below. If the sheet is blank (or only has a default `Sheet1` tab), the first sync creates the required tabs from the website data. Do not connect a partially configured sheet: the bridge intentionally stops if core tabs exist but required tabs are missing.

## 2. Set the server environment variables

In your hosting provider's environment settings, set:

- `GOOGLE_SHEETS_WEBAPP_URL` = the deployed Apps Script URL ending in `/exec`
- `GOOGLE_SHEETS_TOKEN` = the exact secret entered in `SYNC_TOKEN`
- `GOOGLE_SHEETS_POLL_MS` = `30000` (optional; defaults to 30 seconds)

Keep `ADMIN_PASSWORD=iitbhu11` as requested, but it is weak and should be changed before the website is made public. Keep `SESSION_SECRET` stable and private. Redeploy after setting the environment variables.

## 3. Verify the connection

1. Sign in to the website admin panel.
2. Click **Google Sheets status**. If it says not configured, verify the two environment variables and redeploy.
3. Click **Sync Google Sheet now**. The status button should report a recent successful sync.
4. Change a harmless value in the admin panel and confirm the matching cell changes in Google Sheets.
5. Edit that cell in Google Sheets and wait up to about 30–45 seconds for the public website to refresh.

## Sheet tabs and headers

Do not rename these tabs or their header cells after connecting:

- `Site Settings`: `Setting`, `Value` (rows use `l1`, `l2`, `sub`, `cd`, `cdl`, `sess` as keys)
- `Athletes`: `Athlete ID`, `Name`, `Department`, `Roll Number`, `Year`, `Category`, `Primary Event`, `Biography`, `Leadership Role`, `Course Length`, `Graduated`, `Photo URL (optional)`, `Achievements JSON`
- `Medals`: `Competition`, `Medal`, `Event`, `Athlete / Team`, `Performance`
- `Events`: `Status`, `Event Name`, `Date`, `Venue`, `Description`
- `Qualifying Standards`: `Event`, `Type`, `Men Standard`, `Women Standard`, `Record`
- `Heat Schedule`: `Competition`, `Heat / Event`, `Time`, `Lanes / Participants`
- `Training Plan`: `Day`, `Focus`, `Morning Session`, `Evening Session`
- `Gallery`: `Title`, `Competition / Event`, `Category`, `Image URL (optional)`
- `Coaches`: `Name`, `Role`, `Specialty`, `Qualifications / Experience`, `Contact`
- `Alumni`: `Name`, `Batch`, `Event`, `Personal Best`, `Achievements`, `Current Role`
- `Ticker Messages`: `Order`, `Message`
- `Athlete Records`: `Athlete ID`, `Event`, `Personal Best`, `Competition`, `Previous Best`
- `State Backup`: `Chunk`, `JSON fragment` (managed automatically; do not edit or delete it)

The sync writes whole website-data tables when admin changes are saved. Avoid editing the same rows simultaneously in the admin panel and spreadsheet. Uploaded photos are preserved in the hidden `State Backup` data, while ordinary external photo URLs can be edited in the visible tabs. For photo removal, use the website admin panel. Keep a backup before large changes.
