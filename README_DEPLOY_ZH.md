# Cloudflare / Netlify / Supabase 部署说明

下面这套文件可以直接部署到 Cloudflare Pages 或 Netlify：

- `outputs/supabase-static-site/index.html`
- `outputs/supabase-static-site/app.js`
- `outputs/supabase-static-site/styles.css`
- `outputs/supabase-static-site/app-config.js`
- `outputs/supabase-static-site/supabase-schema.sql`

## 1. 先建 Supabase 项目

1. 到 Supabase 创建新项目。
2. 打开 SQL Editor，执行 `supabase-schema.sql`。
3. 到 Project Settings -> API，复制：
   - Project URL
   - anon public key
4. Storage bucket `question-files` 现在只是兼容旧上传记录用；新版“写入后台题库”不会再上传原文件到 Storage。

## 1.5 SQL 执行顺序（2026-08-02 优化版）

本次优化新增了两个 SQL 文件，部署时按顺序执行：

1. `supabase-schema.sql` —— 建表 + 索引（全新项目才需要；老项目跳过）
2. `supabase-rls-hardening.sql` —— 收紧数据库权限（新增 admins 管理员表、is_admin() 校验）
3. `supabase-query-optimization.sql` —— 新增 random_questions 随机取题函数

执行完第 2 步后，先把自己设为管理员，否则网页端的导入/删除题库功能会被拒绝：

```sql
insert into public.admins (user_id)
select id from auth.users where email = '你的邮箱';
```

权限变化摘要：题库所有人可浏览，只有管理员能增删改；答题记录/收藏/考试成绩只有本人能读写。

## 2. 配置前端连接

编辑 `outputs/supabase-static-site/app-config.js`：

```js
window.APP_CONFIG = {
  supabaseUrl: "https://xxxxx.supabase.co",
  supabaseAnonKey: "eyJ...",
  bucket: "question-files",
  aiAnalysisEndpoint: "",
};
```

`aiAnalysisEndpoint` 先留空即可。后续接 AI 时，填一个可接收 `POST` JSON 的接口地址，前端会发送 `{ question }`，并读取返回里的 `analysis` / `explanation` / `text` 字段。

## 3. 题库导入和考试规则

- 上传页可以选择不同级别题库文件夹。
- 系统会从文件夹/文件名自动识别：初级、中级、高级、技师、高级技师、理论、实操。
- 识别不到时使用页面上的默认等级和默认分类。
- 模拟考试只抽理论题：80 道单选、10 道多选、10 道判断。
- 每题 1 分，共 100 分，60 分及格，考试时长 60 分钟。
- 实操题不进入模拟考试，保留在刷题/背题库里使用。

## 4. 直接部署到 Netlify

最简单方式是 Netlify Drop：

1. 登录 Netlify。
2. 打开 Netlify Drop。
3. 把整个 `outputs/supabase-static-site` 文件夹拖进去。
4. 等它生成站点地址。

官方文档：
- https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- https://docs.netlify.com/deploy/create-deploys/

## 5. 直接部署到 Cloudflare Pages

建议用 Pages 的 Direct Upload：

1. 登录 Cloudflare Dashboard。
2. 进入 Workers & Pages -> Create -> Pages。
3. 选择 Direct Upload。
4. 上传 `outputs/supabase-static-site` 整个文件夹，或先压成 zip 再上传。

官方文档：
- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/

## 6. Supabase 数据表说明

`supabase-schema.sql` 会创建这些表：

- `source_files`
- `questions`
- `answer_records`
- `favorites`
- `exam_records`
- `chapters`

当前 AI 解析暂停，`app-config.js` 里的 `aiAnalysisEndpoint` 保持空字符串即可。

## 6.5 前端依赖（CDN）说明

页面已完全本地化，不再依赖任何 CDN，三个库放在 `vendor/` 目录：

- `vendor/vue.global.prod.js` —— Vue 3（3.5.13，生产版）
- `vendor/mammoth.browser.min.js` —— mammoth 1.8.0（解析 docx 用）
- `vendor/supabase.mjs` —— @supabase/supabase-js 2.111.0（esbuild 打成单文件自包含 ESM）

部署时请把整个 `vendor/` 目录一起上传，不要单独漏掉。
如需升级版本：替换对应文件，并把 `supabase.js` 顶部的 `./vendor/supabase.mjs`
导入路径保持一致即可。页面其余部分无外网请求。

部署完成后建议用手机和电脑各打开一次，确认页面正常加载。

## 7. 常见检查项

如果页面能打开，但上传或读取数据失败，先检查：

1. `app-config.js` 是否填了正确的 Supabase URL 和 anon key
2. Supabase SQL 是否已经执行
3. 浏览器是否能访问 Supabase
4. 如果要删除旧版上传文件记录，再检查 Storage bucket 是否存在

## 8. 你现在最该用的文件

- 直接上线：`outputs/supabase-static-site/`
- 数据库结构：`outputs/supabase-static-site/supabase-schema.sql`
- 连接配置：`outputs/supabase-static-site/app-config.js`
- 说明文档：`outputs/supabase-static-site/README_DEPLOY.md`
