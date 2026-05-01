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
