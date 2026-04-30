# Tag and Explore

Recovered deployment and editable source for the Tag and Explore app.

## Deployment

The repository root is configured as a static Vercel deployment. It serves the recovered Vercel bundle from `recovered-deploy/` so the site can be restored without rebuilding the original app.

`vercel.json` rewrites React routes such as `/editor` and `/view/:id` to `index.html`.

## Editable source

`source-restored/` contains a readable Vite/React reconstruction generated from the deployed bundle. Treat it as a recovery source, not a byte-for-byte copy of the original project.

For future edits, use `source-restored/` as the human-readable working source. The static root deployment does not automatically rebuild from this folder.

## Supabase safety

The recovered deployment keeps the existing Supabase project/table/bucket references used by the original bundle:

- URL: `https://bnpxshdnckyubwgkwmpx.supabase.co`
- table: `projects`
- storage bucket: `project-images`

To avoid accidental data loss, project deletion has been disabled in the recovered deployment bundle. Do not add migrations, resets, truncates, or destructive scripts unless the Supabase data has been backed up and the change is intentional.

Anonymous Supabase write access was found to be open during recovery. Use `supabase/policies-readonly-lockdown.sql` as the emergency read-only lock if existing shared work must be protected before a proper authenticated editor is added.

See `docs/OPERATIONS.md` for the recovery notes and beginner-safe operating checklist.
