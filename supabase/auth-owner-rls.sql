-- Login-based ownership rules for Tag and Explore.
--
-- Owner user created in Supabase Auth:
-- newgirl900@naver.com
-- 90276ea9-4119-4067-ace3-6da725d9f885

alter table public.projects
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists projects_owner_id_idx on public.projects(owner_id);

-- Move existing recovered projects under the owner account.
update public.projects
set owner_id = '90276ea9-4119-4067-ace3-6da725d9f885'
where owner_id is null
  and exists (
    select 1
    from auth.users
    where id = '90276ea9-4119-4067-ace3-6da725d9f885'
  );

alter table public.projects enable row level security;

drop policy if exists "Public read projects" on public.projects;
drop policy if exists "Public insert projects" on public.projects;
drop policy if exists "Public update projects" on public.projects;
drop policy if exists "Public delete projects" on public.projects;
drop policy if exists "Anon read projects" on public.projects;
drop policy if exists "Anon insert projects" on public.projects;
drop policy if exists "Anon update projects" on public.projects;
drop policy if exists "Anon delete projects" on public.projects;
drop policy if exists "Anyone can view shared projects" on public.projects;
drop policy if exists "Owners can create projects" on public.projects;
drop policy if exists "Owners can update own projects" on public.projects;
drop policy if exists "Owners can delete own projects" on public.projects;

-- Shared view links keep working without login.
create policy "Anyone can view shared projects"
on public.projects
for select
to anon, authenticated
using (true);

-- Logged-in users can create only their own rows.
create policy "Owners can create projects"
on public.projects
for insert
to authenticated
with check (owner_id = auth.uid());

-- Logged-in users can update only rows they own.
create policy "Owners can update own projects"
on public.projects
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Keep delete available only for the owner at the database level.
-- The current app UI still does not expose project deletion.
create policy "Owners can delete own projects"
on public.projects
for delete
to authenticated
using (owner_id = auth.uid());

grant select on table public.projects to anon;
grant select, insert, update, delete on table public.projects to authenticated;
revoke insert, update, delete on table public.projects from anon;
