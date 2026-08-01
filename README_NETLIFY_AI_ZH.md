# Netlify 添加 AI 解析流程

项目已经接好 AI 解析入口：

- 函数：`netlify/functions/ai-analysis.js`
- 配置：`app-config.js` 里的 `aiAnalysisEndpoint` 已指向 `/.netlify/functions/ai-analysis`
- Netlify 配置：`netlify.toml` 已指定发布目录和函数目录

OpenAI API key 不要写进前端文件，只放到 Netlify 环境变量。

## 1. 推荐部署方式

推荐用 Git 部署，因为 Netlify Functions 需要随项目一起构建部署。

1. 把整个 `question-bank-cloud-upload` 文件夹推到 GitHub / GitLab。
2. Netlify 进入 `Add new site` -> `Import an existing project`。
3. 选择仓库。
4. Build command 留空。
5. Publish directory 使用 `netlify.toml` 默认配置即可，也可以填 `.`。
6. Functions directory 使用 `netlify.toml` 默认配置即可，也可以填 `netlify/functions`。

也可以用 Netlify CLI：

```bash
netlify deploy --prod --dir .
```

如果只用 Netlify Drop 拖拽静态文件，可能不会正确部署 Functions；AI 解析建议用 Git 或 CLI。

## 2. 添加环境变量

进入 Netlify 站点：

`Site configuration` -> `Environment variables` -> `Add a variable`

添加：

```text
OPENAI_API_KEY=你的 OpenAI API key
```

可选添加模型变量：

```text
OPENAI_MODEL=gpt-5.6-luna
```

如果不填 `OPENAI_MODEL`，函数默认使用 `gpt-5.6-luna`。如果想提高解析质量，可以改成 `gpt-5.6-terra` 或 `gpt-5.6-sol`。

添加或修改环境变量后，需要重新部署：

`Deploys` -> `Trigger deploy` -> `Deploy site`

## 3. 确认前端配置

`app-config.js` 里保持：

```js
aiAnalysisEndpoint: "/.netlify/functions/ai-analysis",
```

不要把 OpenAI key 放在 `app-config.js`。

## 4. 测试 AI 解析

1. 打开 Netlify 站点。
2. 确认 Supabase 能正常读取题库。
3. 进入 `刷题`。
4. 选择一道题。
5. 点击 `AI解析`。
6. 页面下方出现 `AI解析` 内容即成功。

## 5. 常见问题

### 显示 OPENAI_API_KEY 未配置

Netlify 环境变量没有添加，或添加后没有重新部署。

### 点击 AI解析 没有内容

打开 Netlify 函数日志检查：

`Site configuration` -> `Functions` -> `ai-analysis`

也可以打开浏览器开发者工具，查看 Network 里 `/.netlify/functions/ai-analysis` 的返回。

### 本地直接打开 HTML 时不能用 AI解析

正常。Netlify Function 只有部署到 Netlify 或用 Netlify CLI 本地运行时才存在。本地测试运行：

```bash
netlify dev
```

然后访问 Netlify CLI 给出的本地地址。
