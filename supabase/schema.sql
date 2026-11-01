-- TRPG Archive: Supabase SQL Editor で一度だけ実行してください。

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_key text not null,
  category_code text not null check (category_code in ('00','01','02','03','04','05','99')),
  category_name text not null,
  reading_initial text not null default '他',
  title text not null,
  folder_name text not null,
  relative_path text not null,
  folder_exists boolean not null default true,
  kp_done boolean not null default false,
  pl_done boolean not null default false,
  read_status text not null default '未読' check (read_status in ('未読','既読')),
  r_rating text not null default '未確認' check (r_rating in ('あり','なし','未確認')),
  player_count text not null default '',
  paid_status text not null default '未確認' check (paid_status in ('有償','無償','未確認')),
  author_name text not null default '',
  url text not null default '',
  memo text not null default '',
  is_favorite boolean not null default false,
  thumbnail_object_path text,
  thumbnail_filename text,
  thumbnail_last_modified bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, folder_key)
);

create index if not exists scenarios_user_title_idx on public.scenarios (user_id, title);
create index if not exists scenarios_user_category_idx on public.scenarios (user_id, category_code);

-- updated_at を更新するトリガー
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_scenarios_updated_at on public.scenarios;
create trigger set_scenarios_updated_at
before update on public.scenarios
for each row execute function public.set_updated_at();

alter table public.scenarios enable row level security;

drop policy if exists "Users can read their own scenarios" on public.scenarios;
create policy "Users can read their own scenarios"
  on public.scenarios for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own scenarios" on public.scenarios;
create policy "Users can insert their own scenarios"
  on public.scenarios for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own scenarios" on public.scenarios;
create policy "Users can update their own scenarios"
  on public.scenarios for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own scenarios" on public.scenarios;
create policy "Users can delete their own scenarios"
  on public.scenarios for delete to authenticated
  using (auth.uid() = user_id);

-- サムネイルは非公開バケットに保存。アプリはログイン後に署名付きURLで表示します。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scenario-thumbnails', 'scenario-thumbnails', false, 8388608,
        array['image/png','image/jpeg','image/webp','image/gif','image/avif'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own scenario thumbnails" on storage.objects;
create policy "Users can read their own scenario thumbnails"
  on storage.objects for select to authenticated
  using (bucket_id = 'scenario-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can upload their own scenario thumbnails" on storage.objects;
create policy "Users can upload their own scenario thumbnails"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'scenario-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their own scenario thumbnails" on storage.objects;
create policy "Users can update their own scenario thumbnails"
  on storage.objects for update to authenticated
  using (bucket_id = 'scenario-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scenario-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their own scenario thumbnails" on storage.objects;
create policy "Users can delete their own scenario thumbnails"
  on storage.objects for delete to authenticated
  using (bucket_id = 'scenario-thumbnails' and (storage.foldername(name))[1] = auth.uid()::text);
