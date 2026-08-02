# Supabase 数据库配置说明

当前阶段先暂停 AI 解析，优先完成 Supabase 数据库、题库导入、刷题记录、收藏、考试记录这些基础链路。

## 当前前端连接

线上站点读取：

```text
https://question-bank-cloud-upload.netlify.app/app-config.js
```

当前配置：

```js
supabaseUrl: "https://nhzlueflodhoqdrdpjub.supabase.co"
bucket: "question-files"
useAnonymousAuth: false
aiAnalysisEndpoint: ""
```

`aiAnalysisEndpoint` 已留空，表示 AI 解析暂停。后续恢复 AI 时，再改回 `/api/ai-analysis` 并补 Netlify 环境变量即可。

## 需要执行的 SQL

在 Supabase 后台执行仓库里的：

```text
supabase-schema.sql
```

操作路径：

```text
Supabase -> SQL Editor -> New query -> 粘贴 supabase-schema.sql 全部内容 -> Run
```

这份 SQL 可以重复执行。它会创建或补齐：

- `profiles`
- `source_files`
- `questions`
- `answer_records`
- `favorites`
- `exam_records`
- `chapters`
- Storage bucket：`question-files`
- RLS 策略
- 常用索引
- `questions.updated_at` 自动更新时间触发器
- 五个默认章节占位：初级、中级、高级、技师、高级技师

## 为什么这次要更新 RLS

当前静态版前端没有正式登录系统，用户标识来自浏览器本地 UUID。

旧 SQL 里 `answer_records`、`favorites`、`exam_records` 使用：

```sql
auth.uid() = user_id
```

这要求 Supabase Auth 登录用户。当前 `useAnonymousAuth: false` 时，收藏、刷题记录、考试记录会被 RLS 拦住。

新版 SQL 把这些表改成 MVP 阶段的公开读写策略，由前端按本地 `user_id` 过滤。这样题库导入、收藏、刷题记录、考试记录可以先完整跑通。

## 执行后验证

SQL 成功后，打开线上站点：

```text
https://question-bank-cloud-upload.netlify.app/
```

然后按顺序测：

1. 首页能打开，不再报缺表。
2. 后台管理进入题库导入。
3. 先上传 `sample-questions.csv` 验证链路，或直接上传正式 `.txt` / `.docx` 题库文件。
4. `questions` 表出现题目。
5. 随便答一题，`answer_records` 出现记录。
6. 收藏一题，`favorites` 出现记录。
7. 生成一次模拟考试，`exam_records` 出现记录。

## 当前数据库状态提醒

我已用线上公开 key 测过：Supabase 连接是通的，但 `questions` 表当前为 0 条。

所以 SQL 完成后，还需要导入题库数据，首页五个等级卡片才会显示题目数量。
