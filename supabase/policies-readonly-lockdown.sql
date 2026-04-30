-- Emergency read-only lockdown for Tag and Explore.
-- Run this in the Supabase SQL editor for the `thinglink` project.
--
-- Result:
-- - Public viewers can still read shared projects.
-- - Anonymous browser users cannot create, edit, or delete project rows.
-- - This protects existing work, but the current editor will not be able to save
--   until a proper authenticated or server-side save flow is added.

alter table public.projects enable row level security;

drop policy if exists "Public read projects" on public.projects;
drop policy if exists "Public insert projects" on public.projects;
drop policy if exists "Public update projects" on public.projects;
drop policy if exists "Public delete projects" on public.projects;
drop policy if exists "Anon read projects" on public.projects;
drop policy if exists "Anon insert projects" on public.projects;
drop policy if exists "Anon update projects" on public.projects;
drop policy if exists "Anon delete projects" on public.projects;

create policy "Public read projects"
on public.projects
for select
to anon
using (true);

revoke insert, update, delete on table public.projects from anon;
grant select on table public.projects to anon;

-- Storage bucket lockdown for existing project images.
-- Public image links continue to work, but anonymous users cannot upload,
-- replace, or delete files in `project-images`.

drop policy if exists "Public read project images" on storage.objects;
drop policy if exists "Public upload project images" on storage.objects;
drop policy if exists "Public update project images" on storage.objects;
drop policy if exists "Public delete project images" on storage.objects;
drop policy if exists "Anon read project images" on storage.objects;
drop policy if exists "Anon upload project images" on storage.objects;
drop policy if exists "Anon update project images" on storage.objects;
drop policy if exists "Anon delete project images" on storage.objects;

create policy "Public read project images"
on storage.objects
for select
to anon
using (bucket_id = 'project-images');

revoke insert, update, delete on table storage.objects from anon;
grant select on table storage.objects to anon;
