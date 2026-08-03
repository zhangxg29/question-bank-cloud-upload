-- ============================================================
-- 第4版功能：管理员看板 / 题目纠错反馈 / 题库版本通知
-- 在 Supabase 控制台 SQL Editor 中执行一次（可重复执行）。
-- 依赖：已先执行 supabase-rls-hardening.sql（is_admin() 存在）。
-- ============================================================

-- 1) profiles 增加班组字段
alter table public.profiles
  add column if not exists team text not null default '';

-- 2) 管理员读权限（看板统计用）
drop policy if exists "profiles admin select" on public.profiles;
create policy "profiles admin select"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "answer records admin select" on public.answer_records;
create policy "answer records admin select"
  on public.answer_records for select to authenticated
  using (public.is_admin());

drop policy if exists "exam records admin select" on public.exam_records;
create policy "exam records admin select"
  on public.exam_records for select to authenticated
  using (public.is_admin());

drop policy if exists "favorites admin select" on public.favorites;
create policy "favorites admin select"
  on public.favorites for select to authenticated
  using (public.is_admin());

-- 3) 题目纠错反馈表
create table if not exists public.question_feedback (
  id bigserial primary key,
  question_id bigint not null references public.questions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  message text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.question_feedback enable row level security;

drop policy if exists "feedback insert own" on public.question_feedback;
create policy "feedback insert own"
  on public.question_feedback for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "feedback select own" on public.question_feedback;
create policy "feedback select own"
  on public.question_feedback for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "feedback admin select" on public.question_feedback;
create policy "feedback admin select"
  on public.question_feedback for select to authenticated
  using (public.is_admin());

drop policy if exists "feedback admin update" on public.question_feedback;
create policy "feedback admin update"
  on public.question_feedback for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists question_feedback_status_idx
  on public.question_feedback (status, created_at desc);

-- 4) 题库版本号（前端据此提示“题库已更新，点击同步”）
create table if not exists public.app_meta (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_meta enable row level security;

drop policy if exists "app meta select public" on public.app_meta;
create policy "app meta select public"
  on public.app_meta for select to anon, authenticated
  using (true);

drop policy if exists "app meta admin insert" on public.app_meta;
create policy "app meta admin insert"
  on public.app_meta for insert to authenticated
  with check (public.is_admin());

drop policy if exists "app meta admin update" on public.app_meta;
create policy "app meta admin update"
  on public.app_meta for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

insert into public.app_meta (key, value)
values ('bank_version', '1')
on conflict (key) do nothing;
