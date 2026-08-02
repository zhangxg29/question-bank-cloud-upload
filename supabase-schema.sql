create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.source_files (
  id bigserial primary key,
  original_name text not null,
  storage_path text,
  public_url text,
  level text not null default 'junior',
  category text not null default '输气工基础技术',
  status text not null default 'uploaded',
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  unrecognized_count integer not null default 0,
  log text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id bigserial primary key,
  level text not null default 'junior',
  category text not null default '输气工基础技术',
  chapter text not null default '',
  question text not null default '',
  option_a text not null default '',
  option_b text not null default '',
  option_c text not null default '',
  option_d text not null default '',
  analysis text not null default '',
  question_type text not null,
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  answer jsonb not null default '[]'::jsonb,
  explanation text not null default '',
  source_file_id bigint references public.source_files(id) on delete set null,
  fingerprint text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists username text not null default '',
  add column if not exists created_at timestamptz not null default now();

alter table public.source_files
  add column if not exists original_name text not null default '',
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists level text not null default 'junior',
  add column if not exists category text not null default '输气工基础技术',
  add column if not exists status text not null default 'uploaded',
  add column if not exists imported_count integer not null default 0,
  add column if not exists duplicate_count integer not null default 0,
  add column if not exists unrecognized_count integer not null default 0,
  add column if not exists log text not null default '',
  add column if not exists created_at timestamptz not null default now();

alter table public.questions
  add column if not exists level text not null default 'junior',
  add column if not exists category text not null default '输气工基础技术',
  add column if not exists chapter text not null default '',
  add column if not exists question text not null default '',
  add column if not exists option_a text not null default '',
  add column if not exists option_b text not null default '',
  add column if not exists option_c text not null default '',
  add column if not exists option_d text not null default '',
  add column if not exists analysis text not null default '',
  add column if not exists question_type text not null default 'single',
  add column if not exists stem text not null default '',
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists answer jsonb not null default '[]'::jsonb,
  add column if not exists explanation text not null default '',
  add column if not exists source_file_id bigint references public.source_files(id) on delete set null,
  add column if not exists fingerprint text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists questions_fingerprint_unique
  on public.questions (fingerprint)
  where fingerprint is not null;

create table if not exists public.answer_records (
  id bigserial primary key,
  question_id bigint not null references public.questions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  answer text not null default '',
  correct boolean,
  submitted_answer jsonb not null default '[]'::jsonb,
  is_correct boolean,
  created_at timestamptz not null default now()
);

alter table public.answer_records
  add column if not exists question_id bigint references public.questions(id) on delete cascade,
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists answer text not null default '',
  add column if not exists correct boolean,
  add column if not exists submitted_answer jsonb not null default '[]'::jsonb,
  add column if not exists is_correct boolean,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.favorites (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.favorites
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists question_id bigint references public.questions(id) on delete cascade,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'favorites'
      and constraint_name = 'favorites_question_id_key'
  ) then
    alter table public.favorites drop constraint favorites_question_id_key;
  end if;
end $$;

create unique index if not exists favorites_user_question_unique
  on public.favorites (user_id, question_id);

create table if not exists public.exam_records (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  score integer not null default 0,
  total integer not null default 0,
  correct integer not null default 0,
  duration integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.exam_records
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists score integer not null default 0,
  add column if not exists total integer not null default 0,
  add column if not exists correct integer not null default 0,
  add column if not exists duration integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.chapters (
  id bigserial primary key,
  level text not null default 'junior',
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(level, name)
);

alter table public.chapters
  add column if not exists level text not null default 'junior',
  add column if not exists name text not null default '',
  add column if not exists sort_order integer not null default 0,
  add column if not exists created_at timestamptz not null default now();

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
  before update on public.questions
  for each row
  execute function public.set_updated_at();

create index if not exists source_files_created_at_idx on public.source_files (created_at desc);
create index if not exists questions_level_idx on public.questions (level);
create index if not exists questions_level_type_idx on public.questions (level, question_type);
create index if not exists questions_source_file_idx on public.questions (source_file_id);
create index if not exists questions_chapter_idx on public.questions (chapter);
create index if not exists answer_records_user_created_idx on public.answer_records (user_id, created_at desc);
create index if not exists answer_records_question_idx on public.answer_records (question_id);
create index if not exists exam_records_user_created_idx on public.exam_records (user_id, created_at desc);
create index if not exists chapters_level_sort_idx on public.chapters (level, sort_order, name);

alter table public.profiles enable row level security;
alter table public.source_files enable row level security;
alter table public.questions enable row level security;
alter table public.answer_records enable row level security;
alter table public.favorites enable row level security;
alter table public.exam_records enable row level security;
alter table public.chapters enable row level security;

drop policy if exists "public profiles" on public.profiles;
drop policy if exists "public source files" on public.source_files;
drop policy if exists "public questions" on public.questions;
drop policy if exists "public answer records" on public.answer_records;
drop policy if exists "public favorites" on public.favorites;
drop policy if exists "public exam records" on public.exam_records;
drop policy if exists "public chapters" on public.chapters;

create policy "public profiles" on public.profiles
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public source files" on public.source_files
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public questions" on public.questions
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public answer records" on public.answer_records
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public favorites" on public.favorites
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public exam records" on public.exam_records
  for all to anon, authenticated
  using (true)
  with check (true);

create policy "public chapters" on public.chapters
  for all to anon, authenticated
  using (true)
  with check (true);

insert into public.chapters (level, name, sort_order)
values
  ('junior', '初级题库', 10),
  ('middle', '中级题库', 20),
  ('senior', '高级题库', 30),
  ('technician', '技师题库', 40),
  ('senior_technician', '高级技师题库', 50)
on conflict (level, name) do nothing;

insert into storage.buckets (id, name, public)
values ('question-files', 'question-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "public upload question files" on storage.objects;
drop policy if exists "public read question files" on storage.objects;
drop policy if exists "public update question files" on storage.objects;
drop policy if exists "public delete question files" on storage.objects;

create policy "public upload question files"
  on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'question-files');

create policy "public read question files"
  on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'question-files');

create policy "public update question files"
  on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'question-files')
  with check (bucket_id = 'question-files');

create policy "public delete question files"
  on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'question-files');
