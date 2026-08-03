-- ============================================================
-- 手机号登录支持 + 固定管理员手机号
-- 在 Supabase 控制台 SQL Editor 中执行一次（可重复执行）。
-- 前置：已执行 supabase-rls-hardening.sql。
-- ============================================================

-- 1) admins 表增加手机号字段（通过手机号登录的账号也能识别管理员）
alter table public.admins
  add column if not exists phone text;

-- 允许只按手机号登记管理员（user_id 可空，有值时仍唯一）
alter table public.admins drop constraint if exists admins_pkey;
alter table public.admins alter column user_id drop not null;
create unique index if not exists admins_user_id_unique
  on public.admins (user_id)
  where user_id is not null;

create unique index if not exists admins_phone_unique
  on public.admins (phone)
  where phone is not null;

-- 2) is_admin() 支持：用户ID匹配 或 手机号匹配
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
       or phone = coalesce(auth.jwt() ->> 'phone', '')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) 固定管理员手机号（刘天官 / 王鑫宇 / 李善峰 / 李志猛）
insert into public.admins (phone)
values
  ('18206005547'),
  ('18025098137'),
  ('15865466262'),
  ('18954375209')
on conflict do nothing;
