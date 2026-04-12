# claude-worker-proxy

一个运行在 Cloudflare Workers 上的轻量代理，在 Claude Messages API 风格请求和 Gemini / OpenAI 兼容接口之间做转换。

上游仓库：[glidea/claude-worker-proxy](https://github.com/glidea/claude-worker-proxy)

## 功能

- 支持 `POST /gemini/v1/messages` 和 `POST /openai/v1/messages`
- 支持普通响应和流式响应
- 支持 `system`、`messages`、`temperature`、`max_tokens`、`stop_sequences`、`top_p`
- 支持工具调用：`tools`、`tool_choice`、`tool_use`、`tool_result`
- 支持用户消息里的图片输入
  - Gemini：支持 `base64` 和可访问的 `http/https` 图片 URL，Worker 会先抓取并转为 `inlineData`
  - OpenAI：支持 `base64` 和图片 URL，其中 URL 直接透传给上游
- 使用请求头里的原始 API key 访问目标厂商，不在 Worker 中保存模型 API Key

## 工作方式

请求路径决定目标厂商：

| 路径 | 目标接口 |
| --- | --- |
| `/gemini/v1/messages` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` 或流式接口 |
| `/openai/v1/messages` | `https://api.openai.com/v1/chat/completions` |

请求体使用 Claude Messages API 的常见字段。Worker 会根据路径转换请求体、鉴权头和响应格式。

## 环境要求

- Node.js & npm
- `npm install`
- Cloudflare Wrangler 登录状态；首次使用建议先执行 `wrangler login`

## 本地开发

启动本地服务：

```bash
npm run dev
```

默认会监听 `http://localhost:8080`。

## 部署

部署到 Cloudflare Workers：

```bash
npm run deploycf
```

## 请求示例

### Gemini

```bash
curl -X POST http://localhost:8080/gemini/v1/messages \
  -H "x-api-key: YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_GEMINI_MODEL",
    "max_tokens": 1024,
    "messages": [
      { "role": "user", "content": "你好，简单介绍一下你自己。" }
    ]
  }'
```

### OpenAI

```bash
curl -X POST http://localhost:8080/openai/v1/messages \
  -H "x-api-key: YOUR_OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_OPENAI_MODEL",
    "max_tokens": 1024,
    "messages": [
      { "role": "user", "content": "你好，简单介绍一下你自己。" }
    ]
  }'
```

流式响应只需要在请求体中加入：

```json
{
  "stream": true
}
```

## 鉴权

代理会从以下任一请求头读取目标厂商 API Key：

- `x-api-key: YOUR_PROVIDER_API_KEY`
- `Authorization: YOUR_PROVIDER_API_KEY`

读取后，代理会自动转换为目标厂商需要的鉴权方式：

- Gemini：`x-goog-api-key`
- OpenAI：`Authorization: Bearer ...`

## 路径和错误

有效路径必须是：

```text
/{type}/v1/messages
```

其中 `type` 目前支持：

- `gemini`
- `openai`

常见错误：

- 非 `POST` 请求会返回 `405 Method not allowed`
- 路径不是 `/{type}/v1/messages` 会返回 `400` 或 `404`
- 缺少 `x-api-key` 或 `Authorization` 会返回 `401`
- 不支持的 `type` 会返回 `400 Unsupported type`

## 在 Claude Code 中使用

把 Worker 地址作为 Anthropic 兼容入口即可。下面以 Gemini 为例：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/gemini",
    "ANTHROPIC_API_KEY": "YOUR_GEMINI_API_KEY",
    "ANTHROPIC_MODEL": "YOUR_GEMINI_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL": "YOUR_FAST_MODEL",
    "API_TIMEOUT_MS": "600000"
  }
}
```

使用 OpenAI 后端时，把 `ANTHROPIC_BASE_URL` 改为：

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/openai
```

同时把 `ANTHROPIC_API_KEY` 和模型名换成对应 OpenAI 配置。

## 已知限制

- 仅实现 Claude Messages API 的常用字段转换，不是完整 Anthropic API 兼容层
- 不支持 Anthropic `file` 类型图片来源
- Gemini 图片 URL 会由 Worker 先拉取并转为 `inlineData`，因此图片地址必须是可公开访问的 `http` 或 `https` URL
- 目标厂商返回非成功状态时，代理会直接返回原始响应

