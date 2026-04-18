# Claude Worker Proxy

将 Claude Code 接入 [OpenCode Go](https://opencode.ai/docs/zh-cn/go)，$5 首月即可使用 Claude Code，无需 Anthropic API Key。

部署在 Cloudflare Workers，轻量快速。

## 快速部署

### 1. 部署 Worker

```bash
npm install
npx wrangler login
npm run deploycf
```

部署成功后获取 Worker URL，如 `https://claude-proxy.xxx.workers.dev`。

### 2. 配置 Claude Code

在 Claude Code 配置中加入：

```json
{
    "env": {
        "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev/openai",
        "ANTHROPIC_API_KEY": "Your OpenCode Go API Key",
        "ANTHROPIC_MODEL": "glm-5.1"
    }
}
```

或者：（Minimax 的模型使用的 Claude 兼容的接口）
```json
{
    "env": {
        "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev/claude",
        "ANTHROPIC_API_KEY": "Your OpenCode Go API Key",
        "ANTHROPIC_MODEL": "minimax-m2.7"
    }
}
```

完成。现在可以开始使用 Claude Code。

## 支持模型

| 模型 | Model ID |
|------|----------|
| Kimi K2.5 | `kimi-k2.5` |
| GLM-5.1 | `glm-5.1` |
| GLM-5 | `glm-5` |
| MiMo-V2-Pro | `mimo-v2-pro` |
| MiMo-V2-Omni | `mimo-v2-omni` |
| MiniMax M2.7 | `minimax-m2.7` |
| MiniMax M2.5 | `minimax-m2.5` |
| Qwen3.6 Plus | `qwen3.6-plus` |
| Qwen3.5 Plus | `qwen3.5-plus` |

## 功能

- **流式输出** — 支持 SSE 流式响应
- **工具调用** — function calling 完整支持
- **多模型** — 随时切换不同模型

## 常见问题

**Q: API Key 从哪获取？**
A: 在 OpenCode Zen 中订阅 OpenCode Go 后，进入设置复制 API Key。

**Q: 支持 Claude Code 的所有功能吗？**
A: 核心功能均已支持，包括对话、工具调用、流式输出、多轮对话。

**Q: Worker 域名不明原因无法访问怎么办？**
A: 可配置自定义域名，详见 [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

## 本地开发

```bash
npm run dev
```

默认监听 `http://localhost:8080`。
