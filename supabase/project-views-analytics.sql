-- Content view tracking for Tag and Explore.
--
-- Run this in the Supabase SQL editor before relying on in-app view counts.
-- It records one row per counted shared-view visit, while allowing public
-- viewers to insert anonymous view events without exposing viewer identities.

create table if not exists public.project_views (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  viewer_key text not null,
  viewed_at timestamptz not null default now()
);

create index if not exists project_views_project_id_viewed_at_idx
on public.project_views(project_id, viewed_at desc);

create index if not exists project_views_viewer_key_idx
on public.project_views(viewer_key);

alter table public.project_views enable row level security;

drop policy if exists "Anyone can record project views" on public.project_views;
drop policy if exists "Owners can read views for their projects" on public.project_views;

-- Shared links are public, so anonymous visitors need insert access.
create policy "Anyone can record project views"
on public.project_views
for insert
to anon, authenticated
with check (true);

-- Owners can read view rows only for projects they own.
create policy "Owners can read views for their projects"
on public.project_views
for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = project_views.project_id
      and projects.owner_id = auth.uid()
  )
);

grant insert on table public.project_views to anon, authenticated;
grant select on table public.project_views to authenticated;

-- Optional helper view for simple dashboard counts.
create or replace view public.project_view_counts
with (security_invoker = true) as
select
  project_id,
  count(*)::integer as view_count,
  max(viewed_at) as last_viewed_at
from public.project_views
group by project_id;

grant select on public.project_view_counts to authenticated;
