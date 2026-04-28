# Tag and Explore

Recovered deployment and editable source for the Tag and Explore app.

## Deployment

The repository root is configured as a static Vercel deployment. It serves the recovered Vercel bundle from `recovered-deploy/` so the site can be restored without rebuilding the original app.

`vercel.json` rewrites React routes such as `/editor` and `/view/:id` to `index.html`.

## Editable source

`source-restored/` contains a readable Vite/React reconstruction generated from the deployed bundle. Treat it as a recovery source, not a byte-for-byte copy of the original project.

## Supabase safety

The recovered deployment keeps the existing Supabase project/table/bucket references used by the original bundle:

- table: `projects`
- storage bucket: `project-images`

To avoid accidental data loss, project deletion has been disabled in the recovered deployment bundle. Do not add migrations, resets, truncates, or destructive scripts unless the Supabase data has been backed up and the change is intentional.
