# Cloudflare Pages 部署流程

这个项目现在支持 Cloudflare Pages：

- 静态页面：根目录 `index.html` / `app.js` / `styles.css`
- Cloudflare Pages Function：`functions/api/ai-analysis.js`
- 前端 AI 入口：`/api/ai-analysis`

## 1. 推荐部署方式

推荐使用 Git 部署。

1. 把整个 `question-bank-cloud-upload` 文件夹推到 GitHub / GitLab。
2. 打开 Cloudflare Dashboard。
3. 进入 `Workers & Pages` -> `Create` -> `Pages`。
4. 选择 `Connect to Git`。
5. 选择你的仓库。
6. Build command 留空。
7. Build output directory 填：

```text
/
```

如果 Cloudflare 页面不接受 `/`，就填：

```text
.
```

8. 部署。

## 2. 添加环境变量

如果只使用已经存好的题库解析，不需要 OpenAI API key。

如果还要继续点页面里的 `AI解析` 按钮实时生成新解析，需要在 Cloudflare Pages 添加变量：

进入项目：

`Settings` -> `Environment variables`

添加：

```text
OPENAI_API_KEY=你的 OpenAI API key
```

可选：

```text
OPENAI_MODEL=gpt-5.6-luna
```

保存后重新部署一次。

## 3. 确认前端配置

`app-config.js` 里保持：

```js
aiAnalysisEndpoint: "/api/ai-analysis",
```

Supabase 配置继续使用：

```js
supabaseUrl: "你的 Supabase URL",
supabaseAnonKey: "你的 Supabase anon key",
```

## 4. 测试

1. 打开 Cloudflare Pages 网址。
2. 进入 `刷题`。
3. 选择题目。
4. 单选/判断点选后应自动判定。
5. 正确项变绿，错误选择变红。
6. 下方显示题库里已保存的解析。

## 5. Netlify 兼容

项目也保留 Netlify 支持：

- Netlify Function：`netlify/functions/ai-analysis.js`
- Netlify 路由兼容：`_redirects`

所以同一个前端地址 `/api/ai-analysis` 在 Netlify 和 Cloudflare Pages 上都能用。
