把各家（Gemini，OpenAI）的模型 API 转换成 Claude 格式提供服务

## 特性

- 🚀 一键部署到 Cloudflare Workers
- 🔄 兼容 Claude Code。配合 [One-Balance](https://github.com/glidea/one-balance) 低成本，0 费用使用 Claude Code
- 📡 支持流式和非流式响应
- 🛠️ 支持工具调用
- 🎯 零配置，开箱即用

## 快速部署

```bash
git clone https://github.com/glidea/claude-worker-proxy
cd claude-worker-proxy
npm install
wrangler login # 如果尚未安装：npm i -g wrangler@latest
npm run deploycf
```

## 使用方法

```bash
# 例子：以 Claude 格式请求 Gemini 后端
curl -X POST https://claude-worker-proxy.xxxx.workers.dev/gemini/v1/messages \
  -H "x-api-key: YOUR_GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

### 参数说明

- URL 格式：`{worker_url}/{type}/v1/messages`
- `type`: 目标厂商类型，目前支持 `gemini`, `openai`
- 目标厂商 API 基础地址已内置：`gemini` 使用 `https://generativelanguage.googleapis.com/v1beta`，`openai` 使用 `https://api.openai.com/v1`
- `x-api-key`: 目标厂商的 API Key

### 在 Claude Code 中使用

```bash
# 编辑 ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://claude-worker-proxy.xxxx.workers.dev/gemini",
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: YOUR_KEY",
    "ANTHROPIC_MODEL": "gemini-2.5-pro", # 大模型，按需修改
    "ANTHROPIC_SMALL_FAST_MODEL": "gemini-2.5-flash", # 小模型。也许你并不需要 ccr 那么强大的 route
    "API_TIMEOUT_MS": "600000"
  }
}

claude
```


---

<table>
  <tr>
    <td align="center">
      <img src="https://github.com/glidea/zenfeed/blob/main/docs/images/wechat.png?raw=true" alt="Wechat QR Code" width="300">
      <br>
      <strong>AI 学习交流社群</strong>
    </td>
    <td align="center">
      <img src="https://github.com/glidea/banana-prompt-quicker/blob/main/images/glidea.png?raw=true" width="250">
      <br>
      <strong><a href="https://glidea.zenfeed.xyz/">我的其它项目</a></strong>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="https://github.com/glidea/banana-prompt-quicker/blob/main/images/readnote.png?raw=true" width="400">
      <br>
      <strong><a href="https://www.xiaohongshu.com/user/profile/5f7dc54d0000000001004afb">📕 小红书账号 - 持续分享 AI 原创</a></strong>
    </td>
  </tr>
</table>
