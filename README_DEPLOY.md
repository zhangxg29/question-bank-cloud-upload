# Supabase + Netlify / Cloudflare 静态版

这是一个不需要后端服务器的第一版：

- 前端：纯静态 HTML + Vue CDN
- 数据库：Supabase Postgres
- 文件：新版导入不再上传原文件，直接批量写入 Supabase 表
- 部署：Netlify Drop 或 Cloudflare Pages Direct Upload

## 1. 先建 Supabase

1. 注册并创建一个 Supabase 项目。
2. 打开 SQL Editor，运行 `supabase-schema.sql`。
3. 到 Project Settings -> API，复制：
   - Project URL
   - anon public key
4. 打开 `app-config.js`，填进去。
5. Storage bucket `question-files` 只用于兼容旧上传记录；新版后台直灌不依赖它。

## 2. 本地先试

直接用任意静态服务器打开这个目录，或双击 `index.html`。

如果题库上传后没反应，先检查浏览器控制台：
- `app-config.js` 是否填写正确
- Supabase RLS 是否已经执行
- 如果要删除旧上传文件，bucket 名称是否是 `question-files`

## Exam and import rules

- The upload page can import folders for different levels.
- Level/category are inferred from folder or file names: 初级, 中级, 高级, 技师, 高级技师, 理论, 实操.
- Mock exams use theory questions only: 80 single choice, 10 multiple choice, 10 judge.
- Each question is 1 point, total 100 points, passing score 60, duration 60 minutes.
- Practical questions stay in practice/memorize mode and are excluded from mock exams.
- `aiAnalysisEndpoint` in `app-config.js` is currently blank because AI explanations are paused.

## 3. 发到 Netlify

最简单是 Netlify Drop：

1. 登录 Netlify。
2. 打开 Netlify Drop。
3. 把整个 `supabase-static-site` 文件夹拖进去。
4. 等它生成 `*.netlify.app` 地址。

官方文档：
- [Netlify Drop 快速开始](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/)
- [Netlify 直接拖拽部署](https://docs.netlify.com/deploy/create-deploys/)

## 4. 发到 Cloudflare Pages

用 Direct Upload：

1. 登录 Cloudflare Dashboard。
2. 进入 Workers & Pages -> Create -> Pages。
3. 选 Direct Upload。
4. 直接上传这个文件夹，或者打包成 zip 上传。

官方文档：
- [Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Cloudflare Pages Overview](https://developers.cloudflare.com/pages/)

## 5. Supabase SQL 说明

这个 SQL 会创建：

- `source_files`
- `questions`
- `answer_records`
- `favorites`
- `exam_records`
- `chapters`

并开启最简单的公开读写策略，适合起步和演示。

后面如果要加账号系统，再把 RLS 改成按用户权限控制即可。

## 6. 题库导入说明

- `.docx`：自动尝试识别单选、多选、判断、实操
- `.doc`：先上传留档，建议转成 `.docx`
- `.txt`：如果按类似题库格式保存，也能试着识别

## 7. 你现在最该做的

1. 填好 `app-config.js`
2. 执行 SQL
3. 上传文件夹到 Netlify 或 Cloudflare
4. 打开站点测试上传
