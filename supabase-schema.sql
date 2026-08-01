create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key,
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

alter table public.questions
  add column if not exists chapter text not null default '';

alter table public.questions
  add column if not exists question text not null default '',
  add column if not exists option_a text not null default '',
  add column if not exists option_b text not null default '',
  add column if not exists option_c text not null default '',
  add column if not exists option_d text not null default '',
  add column if not exists analysis text not null default '';

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
  add column if not exists user_id uuid references public.profiles(id) on delete cascade,
  add column if not exists answer text not null default '',
  add column if not exists correct boolean;

create table if not exists public.favorites (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  question_id bigint not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.favorites
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'favorites' and constraint_name = 'favorites_question_id_key'
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

create table if not exists public.chapters (
  id bigserial primary key,
  level text not null default 'junior',
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(level, name)
);

alter table public.profiles enable row level security;
alter table public.source_files enable row level security;
alter table public.questions enable row level security;
alter table public.answer_records enable row level security;
alter table public.favorites enable row level security;
alter table public.exam_records enable row level security;
alter table public.chapters enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'public profiles'
  ) then
    create policy "public profiles" on public.profiles
      for all to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'source_files' and policyname = 'public source files'
  ) then
    create policy "public source files" on public.source_files
      for all to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'questions' and policyname = 'public questions'
  ) then
    create policy "public questions" on public.questions
      for all to anon, authenticated
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'answer_records' and policyname = 'public answer records'
  ) then
    create policy "public answer records" on public.answer_records
      for all to anon, authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'favorites' and policyname = 'public favorites'
  ) then
    create policy "public favorites" on public.favorites
      for all to anon, authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'exam_records' and policyname = 'public exam records'
  ) then
    create policy "public exam records" on public.exam_records
      for all to anon, authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'chapters' and policyname = 'public chapters'
  ) then
    create policy "public chapters" on public.chapters
      for all to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('question-files', 'question-files', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public upload question files'
  ) then
    create policy "public upload question files"
      on storage.objects
      for insert to anon, authenticated
      with check (bucket_id = 'question-files');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public read question files'
  ) then
    create policy "public read question files"
      on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'question-files');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public update question files'
  ) then
    create policy "public update question files"
      on storage.objects
      for update to anon, authenticated
      using (bucket_id = 'question-files')
      with check (bucket_id = 'question-files');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public delete question files'
  ) then
    create policy "public delete question files"
      on storage.objects
      for delete to anon, authenticated
      using (bucket_id = 'question-files');
  end if;
end $$;
