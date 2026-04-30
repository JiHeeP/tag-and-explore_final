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
