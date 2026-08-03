-- ============================================================
-- 第1步：收紧 RLS 权限（输气工刷题系统）
-- 在 Supabase 控制台 SQL Editor 中执行一次。
-- 幂等：可重复执行。
--
-- 规则摘要：
--   questions / source_files / chapters：匿名可读，仅管理员可写
--   answer_records / favorites / exam_records：仅本人（auth.uid()）读写
--   profiles：仅本人读写
--   storage.objects（question-files）：匿名可读，仅管理员可写
--
-- 首次使用：先把自己设为管理员（在 SQL Editor 中执行）：
--   insert into public.admins (user_id)
--   select id from auth.users where email = '你的邮箱';
-- ============================================================

-- 1) 管理员表（独立于 profiles，普通用户无法自行提权）
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- 不创建任何策略：anon / authenticated 均无法直接访问该表，
-- 只有 is_admin() 函数（security definer）可读取。
revoke all on public.admins from anon, authenticated;

-- 2) 管理员校验函数
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) 删除旧的“全开放”策略
drop policy if exists "public profiles" on public.profiles;
drop policy if exists "public source files" on public.source_files;
drop policy if exists "public questions" on public.questions;
drop policy if exists "public answer records" on public.answer_records;
drop policy if exists "public favorites" on public.favorites;
drop policy if exists "public exam records" on public.exam_records;
drop policy if exists "public chapters" on public.chapters;

-- 4) profiles：仅本人可读、可建、可改（匿名无权限）
drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 5) questions：公开可读，仅管理员可写
drop policy if exists "questions select public" on public.questions;
create policy "questions select public"
  on public.questions for select to anon, authenticated
  using (true);

drop policy if exists "questions admin insert" on public.questions;
create policy "questions admin insert"
  on public.questions for insert to authenticated
  with check (public.is_admin());

drop policy if exists "questions admin update" on public.questions;
create policy "questions admin update"
  on public.questions for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "questions admin delete" on public.questions;
create policy "questions admin delete"
  on public.questions for delete to authenticated
  using (public.is_admin());

-- 6) source_files：公开可读，仅管理员可写
drop policy if exists "source files select public" on public.source_files;
create policy "source files select public"
  on public.source_files for select to anon, authenticated
  using (true);

drop policy if exists "source files admin insert" on public.source_files;
create policy "source files admin insert"
  on public.source_files for insert to authenticated
  with check (public.is_admin());

drop policy if exists "source files admin update" on public.source_files;
create policy "source files admin update"
  on public.source_files for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "source files admin delete" on public.source_files;
create policy "source files admin delete"
  on public.source_files for delete to authenticated
  using (public.is_admin());

-- 7) chapters：公开可读，仅管理员可写
drop policy if exists "chapters select public" on public.chapters;
create policy "chapters select public"
  on public.chapters for select to anon, authenticated
  using (true);

drop policy if exists "chapters admin insert" on public.chapters;
create policy "chapters admin insert"
  on public.chapters for insert to authenticated
  with check (public.is_admin());

drop policy if exists "chapters admin update" on public.chapters;
create policy "chapters admin update"
  on public.chapters for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "chapters admin delete" on public.chapters;
create policy "chapters admin delete"
  on public.chapters for delete to authenticated
  using (public.is_admin());

-- 8) answer_records：仅本人
drop policy if exists "answer records select own" on public.answer_records;
create policy "answer records select own"
  on public.answer_records for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "answer records insert own" on public.answer_records;
create policy "answer records insert own"
  on public.answer_records for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "answer records update own" on public.answer_records;
create policy "answer records update own"
  on public.answer_records for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "answer records delete own" on public.answer_records;
create policy "answer records delete own"
  on public.answer_records for delete to authenticated
  using (user_id = auth.uid());

-- 9) favorites：仅本人
drop policy if exists "favorites select own" on public.favorites;
create policy "favorites select own"
  on public.favorites for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "favorites insert own" on public.favorites;
create policy "favorites insert own"
  on public.favorites for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "favorites update own" on public.favorites;
create policy "favorites update own"
  on public.favorites for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "favorites delete own" on public.favorites;
create policy "favorites delete own"
  on public.favorites for delete to authenticated
  using (user_id = auth.uid());

-- 10) exam_records：仅本人
drop policy if exists "exam records select own" on public.exam_records;
create policy "exam records select own"
  on public.exam_records for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "exam records insert own" on public.exam_records;
create policy "exam records insert own"
  on public.exam_records for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "exam records update own" on public.exam_records;
create policy "exam records update own"
  on public.exam_records for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "exam records delete own" on public.exam_records;
create policy "exam records delete own"
  on public.exam_records for delete to authenticated
  using (user_id = auth.uid());

-- 11) storage.objects：公开可读，仅管理员可写
drop policy if exists "public upload question files" on storage.objects;
drop policy if exists "public read question files" on storage.objects;
drop policy if exists "public update question files" on storage.objects;
drop policy if exists "public delete question files" on storage.objects;

drop policy if exists "question files select public" on storage.objects;
create policy "question files select public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'question-files');

drop policy if exists "question files admin insert" on storage.objects;
create policy "question files admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'question-files' and public.is_admin());

drop policy if exists "question files admin update" on storage.objects;
create policy "question files admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'question-files' and public.is_admin())
  with check (bucket_id = 'question-files' and public.is_admin());

drop policy if exists "question files admin delete" on storage.objects;
create policy "question files admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'question-files' and public.is_admin());

-- 12) 完成提示
-- 执行成功后：
--   a) 把自己设为管理员（把邮箱换成你的）：
--      insert into public.admins (user_id)
--      select id from auth.users where email = '你的邮箱';
--   b) 用未登录状态验证：题库仍可浏览；
--   c) 用普通账号验证：答题/收藏/考试记录正常，但上传、删除、导入会被拒绝。
