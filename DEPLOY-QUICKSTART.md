# Quick deployment checklist

- [ ] Upload all files inside this folder to the root of a GitHub repository.
- [ ] In Render, select **New → Blueprint** and connect the repository.
- [ ] Wait for deployment to finish.
- [ ] Open `https://YOUR-SERVICE.onrender.com/api/health` and confirm `ok: true`.
- [ ] Open `https://YOUR-SERVICE.onrender.com` (the same Render service URL).
- [ ] Click **Admin** and enter the password (`iitbhu11` unless changed in Render).
- [ ] In admin, edit one safe test value, save, refresh the page, and confirm it persists.
- [ ] Remove the test edit and verify again.

**Do not use the GitHub Pages URL.** The frontend and backend must use the same Render service URL for the simple password-only login to work.
