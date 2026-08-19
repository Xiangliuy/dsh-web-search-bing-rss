# dsh-web-search-bing-rss

免费、无需 API Key 的 Bing RSS 联网搜索插件，供 DeepSeek Harness (DSH) 的大模型使用。

## 工作原理

本插件注册一个 `bing-rss` 搜索 provider 到 DSH 的 `ctx.web` 能力层（web capability seam）。大模型调用 `web_search` 工具时，`ctx.web.search()` 会选中此 provider，向 Bing 的公开 RSS 端点 `https://www.bing.com/search?q=<query>&format=rss` 发送请求，解析返回的 RSS 2.0 XML，归一化为 `WebSearchResult`（`sources[]` 含 `url`、`title`、`snippet`、`publishedAt`）。

**无需 API Key**：Bing 的 `?format=rss` 端点是公开的，不要求认证。provider 的 `available()` 始终返回 `true`，因此当没有配置 DeepSeek 官方搜索 provider（或其 API Key 不可用）时，`ctx.web` 自动选中此 provider——`web_search` 开箱即用。

## 与官方 DeepSeek 搜索 provider 的关系

| 特性 | DeepSeek 官方 (`web-search-deepseek`) | Bing RSS (`web-search-bing-rss`) |
|---|---|---|
| 需要 API Key | ✅ `DEEPSEEK_API_KEY` | ❌ 无需 |
| 搜索质量 | 高（DeepSeek 模型 + 原生 web_search） | 中（Bing RSS 有机结果，约 3-10 条） |
| 延迟 | 一次完整模型调用 | 一次 HTTP 请求（~200ms） |
| 成本 | 消耗 token | 免费 |
| 自动选中条件 | `available()` 需要 API Key | `available()` 始终 `true` |

**自动降级**：当 DeepSeek provider 没有 API Key 时（`available()` 返回 `false`），`ctx.web` 的 provider 选择逻辑只找到 Bing RSS 一个可用 provider，自动选中它。当两者都可用时，设置环境变量 `DSH_WEB_SEARCH_PROVIDER=bing-rss` 可强制使用 Bing RSS。

## 文件结构

```
dsh-web-search-bing-rss/
├── package.json          # npm 包定义
├── lib/
│   ├── index.js          # 完整入口（依赖 dsh-settings，用于 npm 包安装方式）
│   ├── entry.mjs         # 轻量入口（自包含，用于 agent preset 直接引用）
│   ├── provider.js       # Bing RSS provider 核心实现（自包含，无外部依赖）
│   └── test-provider.mjs # 纯函数 + 实时网络测试
├── agent.cordis.yml      # agent preset 配置（基于 standard，添加 Bing RSS provider）
├── preset.yml            # preset 元数据
├── install.ps1           # 安装脚本（复制到 ~/.dsh/.agent-presets/）
└── README.md             # 本文档
```

## 安装方式

### 方式一：Agent Preset（推荐）

将插件安装为 DSH agent preset，在新建会话的预设选择器中选择「Bing RSS 搜索」。

```powershell
# 在项目目录执行
cd G:\dsh工作空间\dsh-web-search-bing-rss
.\install.ps1
```

安装脚本会：
1. 将 `entry.mjs` 和 `provider.js` 复制到 `~/.dsh/.agent-presets/bing-rss-search/`
2. 将 `agent.cordis.yml` 和 `preset.yml` 复制到同目录

安装后，重启 DSH，在新建会话时选择「Bing RSS 搜索」预设即可。`web_search` 工具将使用 Bing RSS provider。

### 方式二：手动复制

```powershell
$preset = "$env:USERPROFILE\.dsh\.agent-presets\bing-rss-search"
New-Item -ItemType Directory -Path $preset -Force
Copy-Item "G:\dsh工作空间\dsh-web-search-bing-rss\lib\entry.mjs" "$preset\entry.mjs"
Copy-Item "G:\dsh工作空间\dsh-web-search-bing-rss\lib\provider.js" "$preset\provider.mjs"
Copy-Item "G:\dsh工作空间\dsh-web-search-bing-rss\agent.cordis.yml" "$preset\agent.cordis.yml"
Copy-Item "G:\dsh工作空间\dsh-web-search-bing-rss\preset.yml" "$preset\preset.yml"
```

## 配置

### agent.cordis.yml 中的 config

```yaml
- id: web-search-bing-rss
  name: ./entry.mjs
  config:
    market: en-US        # Bing 市场/区域 (mkt & setlang 参数)
    timeoutMs: 15000     # 请求超时
    maxResults: 10       # 解析的 <item> 上限
    # baseURL: https://www.bing.com  # 可选，覆盖端点
    # userAgent: Mozilla/5.0 ...     # 可选，覆盖 UA
```

### 环境变量

| 变量 | 说明 |
|---|---|
| `DSH_BING_RSS_BASE_URL` | 覆盖 Bing 端点 base URL |
| `DSH_WEB_SEARCH_PROVIDER` | 设为 `bing-rss` 可在有多个 provider 时强制选中此 provider |

## 测试

```powershell
cd G:\dsh工作空间\dsh-web-search-bing-rss
node lib/test-provider.mjs
```

测试覆盖：
- RSS XML 解析（实体解码、HTML 标签剥离、日期解析、多结果、空结果）
- URL 构建（查询编码、market 参数、baseURL 去尾斜杠）
- provider 选项解析（默认值、显式覆盖、无效值回退）
- 实时 Bing RSS 搜索（验证真实 HTTP 请求和结果归一化）

## 技术细节

### Bing RSS 端点

```
GET https://www.bing.com/search?q=<URL-encoded-query>&format=rss&mkt=en-US&setlang=en-US
```

- 返回 RSS 2.0 XML，`<item>` 含 `<title>`、`<link>`、`<description>`、`<pubDate>`
- 每查询约 3-10 条结果
- `www.bing.com` 会 302 重定向到 `cn.bing.com`（区域性），`fetch` 自动跟随
- 无需 User-Agent，但发送桌面 UA 避免偶发的 consent 页面
- 中文查询正常工作

### Provider 接口

```typescript
interface WebSearchProvider {
  readonly id: string;              // "bing-rss"
  available(): boolean;             // 始终 true
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<{
    sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[];
    truncated: boolean;
  }>;
}
```

### 错误处理

- 网络失败 → `WebError` `WEB_PROVIDER_ERROR`
- 调用方取消 → `WebError` `WEB_ABORTED`
- 非 200 响应 → `WebError` `WEB_PROVIDER_ERROR`（含 HTTP 状态码和响应片段）
- 畸形 XML → 空 `sources[]`（不抛错，降级为"无结果"）

### 自包含设计

`provider.js` 不依赖任何 `@deepseek-ai/*` 包——它自定义了一个 `WebError` 类（继承 `Error`，带 `code` 属性），与 `dsh-web` 的 `WebError` 接口兼容。这使得 provider 可以从任意目录加载（包括 agent preset 目录），无需 `node_modules` 解析。

## 许可

MIT
