# Tag and Explore Operations

This repository has two important parts:

- `recovered-deploy/`: the static bundle currently served by the root `index.html`.
- `source-restored/`: the readable Vite/React recovery source for future edits.

The current production bundle already points to:

```text
https://bnpxshdnckyubwgkwmpx.supabase.co
```

The old broken URL was missing the `bnpx` prefix. Do not use it.

## If the app cannot load saved projects

1. Check that the app is using this Supabase URL:

   ```text
   https://bnpxshdnckyubwgkwmpx.supabase.co
   ```

2. In Supabase, open the project named `thinglink`.
3. Open Table Editor and check the `projects` table.
4. Confirm rows such as `땅위의 친구들` and `땅속이꿈틀꿈틀` are present.
5. Open Storage and check the `project-images` bucket.

## Current saved project rows seen during recovery

The live Supabase project contained these rows when checked:

- `땅속이꿈틀꿈틀`
- `codex-share-test`
- `땅위의 친구들`
- `땅속마을 １`
- `땅속마을 2`

## Editing and deployment rule

For future code work, edit `source-restored/` first.

The root deployment does not automatically rebuild from `source-restored/`. If you rebuild the app, replace the static files used by the root deployment only after testing the rebuilt app locally.

## Important security note

The app currently uses a public Supabase key from the browser. If Supabase allows anonymous insert, update, or delete on `projects`, anyone who discovers the API details can change data.

The safest emergency setting is:

- allow public read for shared viewing
- block anonymous insert, update, and delete

That will protect existing shared links, but it will also stop the current browser-only editor from saving until a proper login or server-side save flow is added.

Use `supabase/policies-readonly-lockdown.sql` in the Supabase SQL editor for that emergency lock.

## Cloudflare R2 file uploads

New uploads should go to Cloudflare R2, while project rows stay in Supabase.

R2 bucket:

```text
tag-and-explore-assets
```

Public file base URL:

```text
https://pub-b6a81f0a6fd448998e4c7f92d5ddb388.r2.dev
```

Server environment variables required for uploads:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_PUBLIC_BASE_URL
```

Never put `R2_SECRET_ACCESS_KEY` in frontend code. The browser uploads through `/api/upload`, and that server function sends the file to R2.

## Login-based project ownership

The app now uses Supabase Auth for email/password login.

Current owner account:

```text
newgirl900@naver.com
90276ea9-4119-4067-ace3-6da725d9f885
```

Project rows use:

```text
owner_id
```

Rules:

- Logged-out visitors can open shared `/view/:id` links.
- Logged-in users can create projects owned by their own Supabase user ID.
- Logged-in users can update only projects where `owner_id` matches their user ID.
- Existing recovered projects were assigned to the owner user created in Supabase Auth.

The SQL used for this is in `supabase/auth-owner-rls.sql`.

## Google Street View imports

Street View imports use Google Maps Platform keys:

```text
GOOGLE_MAPS_API_KEY
GOOGLE_MAPS_BROWSER_KEY
VITE_GOOGLE_MAPS_BROWSER_KEY
```

Use `GOOGLE_MAPS_API_KEY` only on serverless routes. Restrict it to Geocoding API and Street View Static API. Use `GOOGLE_MAPS_BROWSER_KEY` or `VITE_GOOGLE_MAPS_BROWSER_KEY` for the browser-restricted Street View key. The browser key must allow Street View Static API and Maps JavaScript API, with HTTP referrer restrictions for production and localhost. The frontend loads that public, referrer-restricted key through `/api/maps-browser-key` so static bundles do not need a build-time key and public share pages can load dynamic Street View.

Before deploying the Street View importer, run:

```text
supabase/google-streetview-source.sql
```

This adds optional source metadata columns to `projects` so imported backgrounds can be saved and reopened.

Large files and 3D models use `/api/upload-url` to get a short-lived signed R2 URL, then the browser uploads directly to R2. The R2 bucket must allow browser `PUT` requests from the production origin. A minimal CORS rule is:

```json
[
  {
    "AllowedOrigins": ["https://YOUR_PRODUCTION_DOMAIN"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

## Multi-scene projects (장면 이어 붙이기)

A project can now hold several scenes, ThingLink-style. Each scene has its own
background (image, 360, 3D, or Street View) and its own hotspots. A hotspot
with content type `장면 이동` moves the viewer to another scene.

Before saving a project with more than one scene, run once in the Supabase SQL
editor:

```text
supabase/project-scenes.sql
```

It only adds a nullable `scenes` JSONB column to `projects`. Nothing is
deleted or rewritten.

Behaviour rules:

- Rows without `scenes` are read as a single-scene project built from
  `image_url`, `background_type`, and `hotspots`.
- On save, `image_url`, `background_type`, `hotspots`, and `source_*` mirror
  scene 1, so older bundles and the home cards keep working.
- If the column is missing, single-scene saves silently fall back to the old
  columns. Multi-scene saves refuse with a message that names the SQL file, so
  no scene is lost.
- Scene 1 must have a background before saving. Students start on scene 1.
- Deleting a scene clears every hotspot link that pointed at it.

## Keeping Supabase awake (free plan auto-pause)

Supabase free projects pause after about a week without database activity. When
paused, saved projects, login, and shared links stop working.

Two automatic keepalives prevent this:

1. **Vercel Cron (main)**: `vercel.json` calls `/api/keepalive` every day at
   21:00 UTC (06:00 KST). It reads one row from `projects`. It only runs on the
   production deployment, so it starts after this change is merged to `main`.
2. **GitHub Actions (backup)**: `.github/workflows/supabase-keepalive.yml` reads
   one row every 3 days. If it fails, GitHub emails the repo owner — that usually
   means the project is paused and needs a restore in the Supabase dashboard.

Manual check: open `https://tagandexplore.vercel.app/api/keepalive`.
`{"ok":true,...}` means Supabase is awake.

Optional: set `CRON_SECRET` in Vercel environment variables so only Vercel Cron can
call `/api/keepalive` (the manual check above then returns 401).

## Deploying a source change (B 방식)

The site still serves the static bundle in `recovered-deploy/`. After editing
`source-restored/`, run:

```text
./scripts/sync-deploy.sh
```

It builds `source-restored/`, copies the new `index-*.js` / `index-*.css` into
`recovered-deploy/assets/`, and updates the bundle names in `index.html`,
`recovered-deploy/index.html`, and `view/*/index.html`. Commit all of them
together. Every branch push gets a Vercel preview at
`dist-git-<branch-with-dashes>-jiheeparks-projects.vercel.app`.

## Quiz keys and locked doors (열쇠/문)

- A hotspot becomes a key when the inspector's "문제(열쇠)로 사용" is on and it
  has at least one answer. Data: `hotspot.quiz = { enabled, question, answers[], hint }`.
- A scene's `장면 이동` hotspots open only after every key in that scene is
  solved. Scenes without keys are never locked.
- Answers are compared after removing all spaces and ignoring case.
- Solved keys are kept per browser tab in `sessionStorage`
  (`projectId:sceneId:hotspotId`). Closing the tab resets them. The editor
  preview has a `문제 풀이 초기화` button.
- "순서대로 진행" (scene list) hides the student scene shortcuts and the
  `첫 장면` button. Stored as `scenes[0].settings.sequential`; when unset it is
  on whenever any key exists.
- Answers are inside the project JSON, so a student using developer tools can
  read them. Accepted for classroom use.

## 360° scenes

360 backgrounds render as a sphere with three.js. Hotspot `x,y` (%) are the
position on the equirectangular image, so existing data keeps working.

WebGL textures need CORS. Instead of adding every site domain to the R2 bucket
CORS rule, the browser loads the panorama through `/api/pano-image?url=...`
(same origin, so no CORS needed). That function only proxies images on the
project's public R2 host (`R2_PUBLIC_BASE_URL` or the default `pub-…r2.dev`)
and lets the Vercel CDN cache them.

Load order: `/api/pano-image` → the R2 URL directly → the R2 URL with a
cache-busting query → flat view with a notice. Vercel functions cannot return
more than about 4.5 MB, so panoramas larger than ~4.4 MB skip the proxy and
only work where the R2 CORS rule allows the site origin. Keep 360 uploads
under 4 MB (for example 4096×2048 JPEG) to be safe.
