-- Google Street View source metadata for imported project backgrounds.

alter table public.projects
  add column if not exists source_provider text,
  add column if not exists source_query text,
  add column if not exists source_lat double precision,
  add column if not exists source_lng double precision,
  add column if not exists source_heading double precision,
  add column if not exists source_pitch double precision,
  add column if not exists source_fov double precision,
  add column if not exists source_pano_id text,
  add column if not exists source_image_url text,
  add column if not exists source_copyright text;

create index if not exists projects_source_provider_idx
on public.projects(source_provider);
