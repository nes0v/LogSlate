# LogSlate

Personal trading journal for index futures (NQ, ES). Client-only PWA — no server, no backend, no sign-up. Your data lives in the browser (IndexedDB) and optionally syncs to your own Google Drive.

## Running locally

```
npm install
npm run dev
```

Build and preview:

```
npm run build
npm run preview
```

## Connecting Google Drive (optional)

LogSlate can auto-sync your journal to your own Google Drive so you can use it from more than one device. The sync file goes into a hidden app-specific folder (`appDataFolder`) that no one else can see — not even you, in the normal Drive UI. Screenshots go into a regular `LogSlate screenshots/` folder you can browse.

To enable sync on your own build you need a free Google Cloud OAuth Client ID:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
2. Enable the **Google Drive API** under *APIs & Services → Library*.
3. Configure the OAuth consent screen (*APIs & Services → OAuth consent screen*):
   - User type: **External**.
   - App name: anything (e.g. "LogSlate").
   - Add your own Google account as a **test user** while the app is in *Testing* mode.
4. Create an OAuth Client ID (*APIs & Services → Credentials → Create Credentials → OAuth client ID*):
   - Application type: **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173` (plus any production origin you deploy to).
5. Copy the Client ID.
6. Copy the env template and paste the ID in:
   ```
   cp .env.example .env.local
   # edit .env.local and set VITE_GOOGLE_CLIENT_ID=<your client id>
   ```
7. Restart `npm run dev`.
8. Open the app → **Settings → Connect Google Drive**. You'll be asked to grant two narrow scopes:
   - `drive.appdata` — read/write the app's own hidden sync file.
   - `drive.file` — read/write only the screenshot files the app itself creates.

No other Drive content is ever touched. You can disconnect at any time from Settings.

### Troubleshooting

- **"Drive access is missing the screenshot folder scope"** banner — happens if you connected before the `drive.file` scope was added. Click *Disconnect* in Settings, then *Connect Google Drive* again.
- **403 errors on upload** — your OAuth consent screen may still be in *Testing* and your account isn't listed as a test user. Add it, or publish the app to *In production*.
- **Sync seems stuck** — open Settings and use *Sync now*. If it still fails, the banner will explain why (network, token expired, scope missing).
