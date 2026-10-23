# Excel Online workbook format — normal editable tabs

The automatic OneDrive integration reads `athletics-website-data.xlsx` from the **root folder** of the connected OneDrive. This workbook is designed as a normal Excel workbook: each kind of website content has its own worksheet and regular columns. **You do not need to edit JSON.** Keep the worksheet names and column headers unchanged.

## Worksheets

- **Site Settings** — edit the values beside `Headline line 1`, `Headline line 2`, and `Subtitle`.
- **Ticker Messages** — add, edit, or remove announcement messages. `Order` controls their display order.
- **Athletes** — one athlete per row. `Athlete ID` must be unique and is used to link athlete records.
- **Athlete Records** — one personal-best/history record per row. Use the matching `Athlete ID` from the Athletes tab.
- **Medals** — one medal/result per row.
- **Events** — one event per row.
- **Qualifying Standards** — one standard per row.
- **Heat Schedule** — one heat/schedule entry per row.
- **Training Plan** — one training session/day entry per row.
- **Gallery** — one gallery item per row. The current site data fields are title, competition/event, and category.
- **Coaches** — one coach or support staff member per row.
- **Alumni** — one alumni profile per row.
- **README** — instructions only; it is not imported as website content.

## Editing rules

1. Use the provided workbook template as your starting point. Do not rename tabs or change header rows.
2. Add new entries by adding a new row under the headers. Edit existing cells directly. Delete a row to remove that entry.
3. Keep Athlete IDs unique, and make sure each Athlete Records row references an existing Athlete ID.
4. Do not remove the three required Site Settings rows or the header rows. Keep the core website headline/subtitle and at least one athlete.
5. Save the workbook in Excel Online. The server checks OneDrive for changes about every 60 seconds; the Admin page also offers **Sync OneDrive now** and **OneDrive status**.

**Sync direction:** OneDrive Excel → website only. Changes made in the website admin interface are not written back to Excel, so Excel is the source of truth while sync is enabled. Each workbook sync replaces the website's complete content state. Download a backup before large edits. The Node server must be running for sync to happen, and public pages check for updates about every 60 seconds.
