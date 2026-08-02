-- ============================================================
-- 第2步：题库查询优化（输气工刷题系统）
-- 新增 random_questions RPC：服务端随机取题，
-- 避免把整个等级题库拉回浏览器后再洗牌。
-- 在 Supabase 控制台 SQL Editor 中执行一次（部署时与其他迁移一起执行）。
-- 幂等：可重复执行。
-- ============================================================

create or replace function public.random_questions(
  p_levels text[] default null,
  p_types text[] default null,
  p_limit integer default 100
)
returns setof public.questions
language sql
stable
set search_path = public
as $$
  select *
  from public.questions
  where (p_levels is null or level = any(p_levels))
    and (p_types is null or question_type = any(p_types))
  order by random()
  limit greatest(0, p_limit);
$$;

revoke all on function public.random_questions(text[], text[], integer) from public;
grant execute on function public.random_questions(text[], text[], integer) to anon, authenticated;
