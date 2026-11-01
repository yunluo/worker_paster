# worker_paster 设计文档

- 日期：2026-11-01
- 状态：已确认（待实现）
- 部署目标：Cloudflare Workers（免费额度）

## 1. 背景与目标

部署在 Cloudflare Workers 上的云粘贴板：把一段文本变成一个可分享的链接，对方打开即可阅读。

使用场景：个人自用 + 小团队内部使用，总人数不超过 10 人，流量小，在免费额度内长期运行。

核心特性：

- **零知识加密**：内容在浏览器端加密，密钥只存在于 URL fragment 中，服务器只存密文
- **过期时间**：链接到期自动失效
- **代码高亮**：分享代码片段时按语言类型高亮显示

设计原则：**简约**。UI 只有两页，无账号体系，无云端管理面板，零维护成本。

## 2. 非目标（Non-goals）

- 不做用户注册/登录/账号系统
- 不做云端粘贴历史管理（服务端无法解密，只存浏览器本地记录）
- 不做防滥用限流（内部信任使用）
- 不做阅后即焚
- 不做文件/图片上传，仅纯文本

## 3. 架构

单个 Worker 承载 API 与静态资源：

```
浏览器
  │  GET /            → Vue SPA（创建页）
  │  GET /:id         → Vue SPA（查看页，SPA fallback）
  │  POST /api/new    → Worker 生成 ID，写入 KV
  │  GET /api/get/:id → Worker 读 KV 返回密文
  ▼
Worker ──绑定──> KV namespace（PASTES）
  └─ [assets] frontend/dist（Vue 3 + Vite 构建产物）
```

- 前端：Vue 3 + Vite，构建产物通过 Workers Static Assets 提供
- 路由：`/api/*` 强制走 Worker（`run_worker_first = ["/api/*"]`），其余请求优先匹配静态资源，未命中时 SPA fallback 回 `index.html`
- 存储：Workers KV，写入时设置 `expirationTtl`，由 Cloudflare 自动删除，无需 Cron
- 配置：`wrangler.toml`

选型依据：KV 原生 TTL 与"密文 blob + 自动过期"模型完全契合；免费额度（10 万读/天、1 千写/天、1GB 存储）对 ≤10 人使用绰绰有余。

## 4. 数据模型

KV：

- Key：8 位 base62 随机 ID（约 62⁸ ≈ 2.2×10¹⁴ 种，碰撞与防枚举足够；生成时若冲突则重试）
- Value：JSON 字符串

```json
{
  "v": 1,
  "ct": "<base64 密文>",
  "iv": "<base64 IV>",
  "lang": "javascript",
  "created_at": 1698800000000,
  "expires_at": 1699400000000
}
```

- `expires_at` 为 `null` 表示永久（KV 不设 TTL）
- 过期档位：`1h` / `1d` / `7d` / `30d` / `never`，写入时换算为 `expirationTtl` 秒数

明文大小上限：**1MB**（前端与 API 双重校验；AES-GCM 密文 + base64 膨胀后仍远小于 KV 单值 25MB 上限）。

## 5. 加密方案

- 算法：AES-256-GCM（WebCrypto 原生，`crypto.subtle`）
- 密钥：创建时浏览器生成 32 字节随机数，编码为 base64url 放入 URL **fragment**：`https://域名/<id>#<key>`。fragment 不会随 HTTP 请求发送，服务器与访问日志均不可见
- IV：每次加密随机 12 字节，随密文存入 KV
- 认证：GCM 自带完整性校验，密钥错误/密文被篡改时解密直接失败

创建流程：

1. 用户输入文本，选择语言类型与过期档位
2. 浏览器生成密钥与 IV，AES-GCM 加密
3. `POST /api/new` 提交 `{ct, iv, lang, expiry}`（明文不出浏览器）
4. Worker 生成 ID、写入 KV（含 TTL），返回 `{id}`
5. 前端拼接完整链接展示，提供复制按钮，并写入本地历史

查看流程：

1. 访客打开 `/:id#<key>`
2. SPA 从 `location.hash` 读取密钥（不发网络请求），`GET /api/get/:id` 获取密文
3. 浏览器解密，按 `lang` 高亮渲染，提供复制原文按钮

## 6. API

### POST /api/new

请求体：

```json
{ "ct": "base64", "iv": "base64", "lang": "javascript", "expiry": "7d" }
```

- `lang` 白名单校验（见 §7）
- `expiry` 白名单校验，`never` 不设 TTL，其余换算 `expirationTtl`
- `ct` base64 解码后长度 ≤ 1MB + 16 字节（AES-GCM 认证标签），即明文上限 1MB
- 返回 `200 { "id": "Ab3xY9kQ" }`
- 校验失败返回 `400 { "error": "..." }`

### GET /api/get/:id

- 命中：`200` 返回 KV 中的 JSON
- 不存在或已过期：统一 `404 { "error": "not found" }`（KV 已自动删除过期数据，无需区分）
- ID 非法字符返回 `404`

### 头部

- API 响应统一 `Content-Type: application/json; charset=utf-8`
- 请求体直接按 JSON 解析，解析失败返回 400（不校验请求 Content-Type 头）

## 7. 前端

### 页面（共两页）

**创建页（首页 `/`）**：

- 文本输入区（textarea）
- 语言类型下拉：`javascript` / `python` / `vue` / `css` / `html` / `json` / `ini` / `yaml` / `toml` / `plaintext`
- 过期时间选择：1小时 / 1天 / 7天 / 30天 / 永久
- 创建按钮 → 展示分享链接 + 复制按钮
- 「我的记录」：创建过的完整链接（含 # 密钥、ID、语言、过期时间）存入浏览器 localStorage，首页下方折叠展示，可单条删除或一键清空；链接包含密钥，换设备/清缓存即消失，仅本机可用

**查看页（`/:id`）**：

- 加密中/加载中 → 解密失败/不存在 的状态提示
- 成功：代码高亮显示（`plaintext` 不高亮）、行号、复制原文按钮
- 字体：代码块使用等宽字体

### 高亮

- highlight.js，npm 依赖打包进构建产物，**不依赖外部 CDN**
- 语言映射：ini/yaml/toml 用 hljs 对应语言；vue 直接按 `xml` 规则高亮（SFC 模板部分高亮即可，不追求 script/style 块内切换语言）
- `plaintext` 纯文本展示，不做高亮

### UI 风格

简约：单栏布局、系统字体、少量留白，深浅色跟随系统（`prefers-color-scheme`）。不引入 UI 组件库，纯手写 CSS（或一个极小的 CSS 文件）。

## 8. 错误处理

| 场景 | 表现 |
|---|---|
| 链接缺 fragment（`/:id` 无密钥） | 查看页提示"链接不完整，缺少密钥" |
| 解密失败（密钥错误/密文损坏） | 提示"解密失败，链接可能不完整或已损坏" |
| 404（不存在/已过期） | 提示"粘贴不存在或已过期" |
| 明文超 1MB | 创建页前端提示，API 返回 400 |
| 语言/档位非法 | API 返回 400，前端默认值兜底 |
| 网络错误 | 通用错误提示 + 重试按钮 |

## 9. 项目结构

```
worker_paster/
├── wrangler.toml              # KV 绑定、assets 指向 frontend/dist、run_worker_first
├── package.json               # 根：Worker 依赖与脚本
├── src/
│   └── index.ts               # Worker：/api/new、/api/get/:id、KV 读写、校验
├── frontend/
│   ├── package.json           # 前端独立依赖（vue、vite、highlight.js）
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.ts
│       ├── router.ts          # / 与 /:id 两路由
│       ├── lib/
│       │   ├── crypto.ts      # 生成密钥/加密/解密（WebCrypto 封装）
│       │   ├── highlight.ts   # hljs 语言映射与注册
│       │   └── history.ts     # localStorage 本地历史
│       └── views/
│           ├── CreateView.vue
│           └── ViewView.vue
└── test/
    ├── api.test.ts            # vitest + @cloudflare/vitest-pool-workers
    └── crypto.test.ts         # 加密往返、错误密钥失败用例
```

- 根与 frontend 各自独立 `package.json`（不引入 workspace 复杂度）
- `wrangler.toml` 关键配置：`[assets] directory = "./frontend/dist"`、`not_found_handling = "single-page-application"`、`run_worker_first = ["/api/*"]`、KV binding `PASTES`

## 10. 测试

- **API 测试**：vitest + `@cloudflare/vitest-pool-workers`，覆盖创建/读取/404/参数校验/TTL 换算
- **加密单测**：密钥生成、加密→解密往返、错误密钥解密必须失败、base64url 编解码
- **手动验收清单**（实现完成后走一遍）：
  1. 本地 `wrangler dev` 创建 → 复制链接打开 → 内容一致且高亮正确
  2. 去掉 fragment 打开 → 提示密钥缺失
  3. 篡改 fragment 一个字符 → 解密失败提示
  4. 1 小时档创建后立即读正常，手动改系统时间或在 KV 控制台删数据后读 → 404
  5. 各语言类型高亮抽查、复制按钮可用

## 11. 部署

1. `cd frontend && npm ci && npm run build`（产物 → `frontend/dist`）
2. 根目录 `npm ci && npx wrangler kv namespace create PASTES`，把返回的 id 填入 `wrangler.toml`
3. `npx wrangler deploy`
4. 首次部署后访问 workers.dev 域名或绑定自定义域名

## 12. 未来扩展（不在本期范围）

- 阅后即焚（读一次删除）
- 自定义过期时长、自定义别名 ID
- CLI/curl 脚本封装 API
