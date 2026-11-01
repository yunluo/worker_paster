# worker_paster 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Cloudflare Workers 上构建零知识加密云粘贴板：内容浏览器端 AES-GCM 加密、密钥放 URL fragment、KV 原生 TTL 自动过期、代码高亮。

**Architecture:** 单 Worker 同时承载 `/api/*` JSON 接口与 Vue 3 SPA 静态资源（Workers Static Assets，SPA fallback）。服务端只存密文 blob（KV，写入时设置 `expirationTtl`），密钥只存在于链接 `#` 后的 fragment 中，永不发送到服务器。

**Tech Stack:** Cloudflare Workers + KV + Static Assets、wrangler 4、TypeScript、Vue 3 + Vue Router + Vite、highlight.js、Vitest + @cloudflare/vitest-pool-workers。包管理器：**bun**（workspaces 一次安装根与 frontend 依赖）。

**规格文档：** `docs/superpowers/specs/2026-11-01-worker-paster-design.md`

**环境注意：**
- Windows（cmd shell）。Node ≥ 20 仍需安装（vitest / wrangler 运行时），bun（≥ 1.1）作为包管理器与脚本入口。
- **严禁使用 `bun test`**——bun 自带测试器与 vitest-pool-workers 不兼容。跑测试一律 `bun run test`（等价 vitest run），单文件用 `bunx vitest run <file>`。
- 若 `bun install` 出现 peer 依赖冲突（vitest 与 @cloudflare/vitest-pool-workers 版本不匹配），按报错提示的版本范围调整 package.json 后重装。
- 运行测试前需要 `frontend/dist` 存在（Task 4 之后由 `bun run build` 生成；fresh clone 先构建再 `bun run test`），因为 vitest-pool-workers 读取 wrangler.toml 的 [assets] 配置时需要该目录。
- **已接受的偏差**（Task 1 质量审查记录）：vitest-pool-workers@0.8.x 内置的 workerd（2025-09）比根 wrangler 4.15x 自带的 workerd（2026-10）旧，测试时 compatibility date 会降级为 2025-09-06 并打印 `[mf:warn]`。本项目只使用 KV/fetch/WebCrypto 等长期稳定 API、无 compat flag 依赖，行为无差异，暂不迁移到已改名的 `@cloudflare/vitest-plugin`；测试运行后的 miniflare EBUSY 临时目录清理告警为 Windows 已知噪音，可忽略。

---

### Task 1: 项目脚手架与测试环境

**Files:**
- Create: `.gitignore`
- Create: `wrangler.toml`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`（骨架，仅返回 404）
- Create: `test/env.test.ts`（KV 绑定冒烟测试）

- [ ] **Step 1: 写 .gitignore**

```gitignore
node_modules/
frontend/dist/
.wrangler/
.idea/
```

- [ ] **Step 2: 写 wrangler.toml**

本任务不配 `[assets]`（frontend/dist 尚不存在，Task 4 再加），避免测试/开发时因目录缺失报错：

```toml
name = "worker-paster"
main = "src/index.ts"
compatibility_date = "2026-10-01"

[[kv_namespaces]]
binding = "PASTES"
# 本地开发/测试用占位 ID；部署前用 `bunx wrangler kv namespace create PASTES`
# 返回的真实 ID 替换（见 Task 10）
id = "00000000000000000000000000000000"
```

- [ ] **Step 3: 写根 package.json**

workspaces 声明让 `bun install` 一次装好根与 frontend 依赖。注意：bun 要求 workspaces 指向的目录必须存在，因此 Task 1 已创建了一个 5 行依赖空的 `frontend/package.json` 占位（Task 4 Step 1 用完整内容覆盖它）：

```json
{
  "name": "worker_paster",
  "private": true,
  "type": "module",
  "workspaces": ["frontend"],
  "scripts": {
    "dev": "wrangler dev",
    "build": "bun --cwd=frontend run build",
    "deploy": "bun run build && wrangler deploy",
    "test": "vitest run",
    "check": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20251014.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0",
    "wrangler": "^4.40.0"
  }
}
```

然后安装依赖：

Run: `bun install`
Expected: 安装成功，无 peer 报错。若出现 peer 依赖冲突，按 npm/bun 报错提示的版本范围调整 package.json 后重装，并在报告中说明实际安装的版本。

- [ ] **Step 4: 写根 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

- [ ] **Step 5: 写 vitest.config.ts**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 6: 写 src/index.ts 骨架**

```ts
export interface Env {
  PASTES: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 7: 写 test/env.test.ts（KV 绑定冒烟测试）**

```ts
import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("KV 绑定 PASTES 可用", async () => {
  await env.PASTES.put("smoke", "ok");
  expect(await env.PASTES.get("smoke")).toBe("ok");
  await env.PASTES.delete("smoke");
});
```

- [ ] **Step 8: 运行测试**

Run: `bun run test`
Expected: 1 passed。若报 "cloudflare:test" 解析失败，确认 `@cloudflare/vitest-pool-workers` 已安装且 tsconfig `types` 包含它。

- [ ] **Step 9: 类型检查**

Run: `bun run check`
Expected: 无错误。

- [ ] **Step 10: Commit**

```bash
git add .gitignore wrangler.toml package.json bun.lock tsconfig.json vitest.config.ts src/index.ts test/env.test.ts
git commit -m "chore: scaffold worker project with vitest-pool-workers"
```

注：bun 生成的锁文件为 `bun.lock`（文本）；若本机 bun 版本生成 `bun.lockb`（二进制），则提交 `bun.lockb`。

---

### Task 2: POST /api/new（TDD）

**Files:**
- Modify: `src/index.ts`
- Create: `test/api.test.ts`

- [ ] **Step 1: 写失败测试 test/api.test.ts（仅 POST 部分）**

```ts
import type { Env } from "../src/index";
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const VALID_BODY = {
  ct: "AAECAwQFBgcICQ==", // 10 字节 base64
  iv: "AAECAwQFBgcICQoL", // 12 字节 base64（16 个 base64 字符）
  lang: "javascript",
  expiry: "7d",
};

async function post(body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/new", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function cleanKv(): Promise<void> {
  const list = await env.PASTES.list();
  await Promise.all(list.keys.map((k) => env.PASTES.delete(k.name)));
}

describe("POST /api/new", () => {
  afterEach(cleanKv);

  it("创建成功：返回 8 位 base62 ID 并写入 KV", async () => {
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/);

    const stored = await env.PASTES.get(id);
    expect(stored).not.toBeNull();
    const record = JSON.parse(stored!) as Record<string, unknown>;
    expect(record.ct).toBe(VALID_BODY.ct);
    expect(record.iv).toBe(VALID_BODY.iv);
    expect(record.lang).toBe("javascript");
    const now = Date.now();
    expect(record.expires_at).toBeGreaterThan(now + 6.9 * 86400_000);
    expect(record.expires_at).toBeLessThan(now + 7 * 86400_000);
  });

  it("never 档位 expires_at 为 null", async () => {
    const res = await post({ ...VALID_BODY, expiry: "never" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const record = JSON.parse((await env.PASTES.get(id))!) as Record<string, unknown>;
    expect(record.expires_at).toBeNull();
  });

  it("非法 lang 返回 400", async () => {
    const res = await post({ ...VALID_BODY, lang: "rust" });
    expect(res.status).toBe(400);
  });

  it("非法 expiry 返回 400", async () => {
    const res = await post({ ...VALID_BODY, expiry: "forever" });
    expect(res.status).toBe(400);
  });

  it("IV 不是 12 字节返回 400", async () => {
    const res = await post({ ...VALID_BODY, iv: "AAAA" });
    expect(res.status).toBe(400);
  });

  it("密文超过 1MB 返回 400", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 17); // 明文上限 + GCM tag 之外
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const res = await post({ ...VALID_BODY, ct: btoa(bin) });
    expect(res.status).toBe(400);
  });

  it("密文恰好 1MB+16 字节允许", async () => {
    const bytes = new Uint8Array(1024 * 1024 + 16);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const res = await post({ ...VALID_BODY, ct: btoa(bin) });
    expect(res.status).toBe(200);
  });

  it("非 JSON 请求体返回 400", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("缺少字段返回 400", async () => {
    const res = await post({ ct: "x", iv: "y" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bunx vitest run test/api.test.ts`
Expected: 全部 FAIL（骨架对 /api/new 返回 404）。

- [ ] **Step 3: 在 src/index.ts 实现 POST /api/new**

将 `src/index.ts` 替换为（GET 部分下一任务实现，此版对 GET 仍返回 404）：

```ts
export interface Env {
  PASTES: KVNamespace;
}

const LANGS = new Set([
  "javascript",
  "python",
  "vue",
  "css",
  "html",
  "json",
  "ini",
  "yaml",
  "toml",
  "plaintext",
]);

const EXPIRY_SECONDS: Record<string, number | null> = {
  "1h": 3600,
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  never: null,
};

// 明文上限 1MB + 16 字节 AES-GCM 认证标签
const MAX_CIPHERTEXT_BYTES = 1024 * 1024 + 16;
const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 8;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = "";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/new" && request.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "请求体不是合法 JSON" }, 400);
      }

      const { ct, iv, lang, expiry } = body;
      if (
        typeof ct !== "string" ||
        typeof iv !== "string" ||
        typeof lang !== "string" ||
        typeof expiry !== "string"
      ) {
        return json({ error: "缺少必要字段" }, 400);
      }
      if (!LANGS.has(lang)) {
        return json({ error: "不支持的语言类型" }, 400);
      }
      if (!(expiry in EXPIRY_SECONDS)) {
        return json({ error: "不支持的过期档位" }, 400);
      }

      let ctBytes: Uint8Array;
      let ivBytes: Uint8Array;
      try {
        ctBytes = base64ToBytes(ct);
        ivBytes = base64ToBytes(iv);
      } catch {
        return json({ error: "base64 编码错误" }, 400);
      }
      if (ctBytes.length > MAX_CIPHERTEXT_BYTES) {
        return json({ error: "内容过大" }, 400);
      }
      if (ivBytes.length !== 12) {
        return json({ error: "IV 长度错误" }, 400);
      }

      const now = Date.now();
      const ttl = EXPIRY_SECONDS[expiry];
      const record = {
        v: 1,
        ct,
        iv,
        lang,
        created_at: now,
        expires_at: ttl === null ? null : now + ttl * 1000,
      };

      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomId();
        if ((await env.PASTES.get(id)) !== null) continue; // ID 碰撞重试
        const options = ttl === null ? undefined : { expirationTtl: ttl };
        await env.PASTES.put(id, JSON.stringify(record), options);
        return json({ id });
      }
      return json({ error: "ID 生成冲突，请重试" }, 500);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test`
Expected: 全部 PASS（含 Task 1 的冒烟测试）。

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/api.test.ts
git commit -m "feat: POST /api/new with validation and KV TTL"
```

---

### Task 3: GET /api/get/:id（TDD）

**Files:**
- Modify: `src/index.ts`
- Modify: `test/api.test.ts`（追加 describe 块）

- [ ] **Step 1: 在 test/api.test.ts 末尾追加失败测试**

```ts
describe("GET /api/get/:id", () => {
  afterEach(cleanKv);

  it("返回已存储的记录", async () => {
    await env.PASTES.put(
      "abcd1234",
      JSON.stringify({ v: 1, ct: "x", iv: "y", lang: "json", created_at: 1, expires_at: 2 }),
    );
    const res = await SELF.fetch("https://example.com/api/get/abcd1234");
    expect(res.status).toBe(200);
    const record = (await res.json()) as Record<string, unknown>;
    expect(record).toMatchObject({ ct: "x", iv: "y", lang: "json" });
  });

  it("不存在的 ID 返回 404", async () => {
    const res = await SELF.fetch("https://example.com/api/get/zzzzzzzz");
    expect(res.status).toBe(404);
  });

  it("格式非法的 ID 返回 404", async () => {
    const res = await SELF.fetch("https://example.com/api/get/short!");
    expect(res.status).toBe(404);
  });

  it("9 位 ID 返回 404", async () => {
    const res = await SELF.fetch("https://example.com/api/get/abcdefghi");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行测试确认新用例失败**

Run: `bunx vitest run test/api.test.ts`
Expected: GET 部分 FAIL，POST 部分 PASS。

- [ ] **Step 3: 在 src/index.ts 的 fetch 中、`return json({ error: "not found" }, 404);` 之前插入 GET 分支**

```ts
    const getMatch = url.pathname.match(/^\/api\/get\/([0-9A-Za-z]{8})$/);
    if (getMatch && request.method === "GET") {
      const raw = await env.PASTES.get(getMatch[1]);
      if (raw === null) return json({ error: "粘贴不存在或已过期" }, 404);
      return new Response(raw, {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
```

- [ ] **Step 4: 运行全部测试**

Run: `bun run test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/api.test.ts
git commit -m "feat: GET /api/get/:id"
```

---

### Task 4: 前端脚手架（Vue 3 + Vite）与静态资源配置

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.ts`
- Create: `frontend/src/router.ts`
- Create: `frontend/src/App.vue`
- Create: `frontend/src/views/CreateView.vue`（占位）
- Create: `frontend/src/views/ViewView.vue`（占位）
- Create: `frontend/src/style.css`
- Modify: `wrangler.toml`（追加 [assets]）

- [ ] **Step 1: 写 frontend/package.json**

```json
{
  "name": "worker-paster-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "check": "vue-tsc --noEmit"
  },
  "dependencies": {
    "highlight.js": "^11.11.0",
    "vue": "^3.5.0",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.0",
    "typescript": "^5.9.0",
    "vite": "^6.3.0",
    "vue-tsc": "^2.2.0"
  }
}
```

Run: `bun install`
Expected: 安装成功（workspaces 一次安装根与 frontend 依赖）。

- [ ] **Step 2: 写 frontend/vite.config.ts**

```ts
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 本地 vite dev server 上把 /api 代理到 wrangler dev
      "/api": "http://127.0.0.1:8787",
    },
  },
});
```

- [ ] **Step 3: 写 frontend/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "useDefineForClassFields": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 4: 写 frontend/index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>worker_paster</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: 写 frontend/src/main.ts**

```ts
import { createApp } from "vue";
import App from "./App.vue";
import "highlight.js/styles/github-dark.css";
import { router } from "./router";
import "./style.css";

createApp(App).use(router).mount("#app");
```

说明：hljs 主题固定用 github-dark，代码块背景恒为深色（见 style.css），深浅色模式下代码块观感一致。

- [ ] **Step 6: 写 frontend/src/router.ts**

```ts
import { createRouter, createWebHistory } from "vue-router";
import CreateView from "./views/CreateView.vue";
import ViewView from "./views/ViewView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: CreateView },
    { path: "/:id", component: ViewView },
  ],
});
```

- [ ] **Step 7: 写 frontend/src/App.vue**

```vue
<template>
  <router-view />
</template>
```

- [ ] **Step 8: 写两个占位视图**

frontend/src/views/CreateView.vue：

```vue
<template>
  <div class="container">
    <h1>worker_paster</h1>
    <p class="muted">创建页（待实现）</p>
  </div>
</template>
```

frontend/src/views/ViewView.vue：

```vue
<template>
  <div class="container">
    <p class="muted">查看页（待实现）</p>
  </div>
</template>
```

- [ ] **Step 9: 写 frontend/src/style.css**

```css
:root {
  color-scheme: light dark;
  --bg: #fafafa;
  --fg: #1a1a1a;
  --muted: #6b7280;
  --card: #ffffff;
  --border: #e5e7eb;
  --accent: #2563eb;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111827;
    --fg: #f3f4f6;
    --muted: #9ca3af;
    --card: #1f2937;
    --border: #374151;
    --accent: #60a5fa;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

.container {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px;
}

textarea,
select,
button {
  font: inherit;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--fg);
}

textarea {
  width: 100%;
  min-height: 240px;
  padding: 12px;
  resize: vertical;
}

button {
  cursor: pointer;
  padding: 8px 16px;
}

button.primary {
  background: var(--accent);
  border: none;
  color: #ffffff;
  padding: 8px 20px;
}

button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin: 12px 0;
}

.error {
  color: #ef4444;
}

.link-box {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  word-break: break-all;
  margin: 12px 0;
}

.muted {
  color: var(--muted);
  font-size: 0.9rem;
}

/* 代码查看（背景恒深色，配 github-dark 主题） */
.code-wrap {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: auto;
  background: #0d1117;
  color: #e6edf3;
  max-height: 70vh;
}

.gutter {
  padding: 12px 8px;
  text-align: right;
  color: #6b7280;
  user-select: none;
  border-right: 1px solid #21262d;
  font-family: ui-monospace, Consolas, monospace;
  line-height: 1.5;
  font-size: 14px;
}

.gutter span {
  display: block;
}

pre.code {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, Consolas, monospace;
  line-height: 1.5;
  font-size: 14px;
}

pre.code code {
  white-space: pre;
}
```

- [ ] **Step 10: 构建前端验证**

Run: `bun --cwd=frontend run build`
Expected: 构建成功，生成 `frontend/dist/`。

Run: `bun --cwd=frontend run check`
Expected: 无类型错误。

- [ ] **Step 11: wrangler.toml 追加 assets 配置**

在文件末尾追加：

```toml
[assets]
directory = "./frontend/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

- [ ] **Step 12: 本地起 Worker 验证静态资源与 SPA fallback**

后台运行 `bun run dev`（wrangler dev，默认端口 8787），然后：

Run: `curl -s http://127.0.0.1:8787/`
Expected: 返回 HTML，含 `<div id="app">`。

Run: `curl -s http://127.0.0.1:8787/abcd1234`
Expected: 同样返回 `index.html`（SPA fallback 生效）。

Run: `curl -s http://127.0.0.1:8787/api/get/abcd1234`
Expected: `{"error":"粘贴不存在或已过期"}`（404，走 Worker）。

验证完成后停止 wrangler dev。

- [ ] **Step 13: Commit**

```bash
git add frontend/package.json frontend/vite.config.ts frontend/tsconfig.json frontend/index.html frontend/src wrangler.toml bun.lock
git commit -m "feat: Vue 3 + Vite frontend scaffold served as static assets"
```

---

### Task 5: 加密库 crypto.ts（TDD）

**Files:**
- Create: `frontend/src/lib/crypto.ts`
- Create: `test/crypto.test.ts`

- [ ] **Step 1: 写失败测试 test/crypto.test.ts**

测试在 vitest-pool-workers（workerd）中运行，WebCrypto 原生可用：

```ts
import { decryptText, encryptText } from "../frontend/src/lib/crypto";
import { describe, expect, it } from "vitest";

describe("crypto", () => {
  it("加密后可解密还原（含中文与换行）", async () => {
    const text = "你好，worker_paster！const x = 1;\nline2\n".repeat(10);
    const { ct, iv, keyFragment } = await encryptText(text);
    const plain = await decryptText(ct, iv, keyFragment);
    expect(plain).toBe(text);
  });

  it("空字符串可加解密", async () => {
    const { ct, iv, keyFragment } = await encryptText("");
    expect(await decryptText(ct, iv, keyFragment)).toBe("");
  });

  it("错误密钥解密失败", async () => {
    const a = await encryptText("secret");
    const b = await encryptText("other");
    await expect(decryptText(a.ct, a.iv, b.keyFragment)).rejects.toThrow();
  });

  it("密文被篡改时解密失败", async () => {
    const { ct, iv, keyFragment } = await encryptText("secret");
    const tampered = ct.slice(0, -4) + "AAAA";
    await expect(decryptText(tampered, iv, keyFragment)).rejects.toThrow();
  });

  it("keyFragment 为 43 字符 base64url", async () => {
    const { keyFragment } = await encryptText("x");
    expect(keyFragment).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bunx vitest run test/crypto.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 frontend/src/lib/crypto.ts**

```ts
// AES-256-GCM 加解密封装：密文与 IV 以标准 base64 存服务端，
// 密钥以 base64url 形式只出现在 URL fragment 中。
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptResult {
  /** base64 密文（提交给服务端） */
  ct: string;
  /** base64 IV（提交给服务端） */
  iv: string;
  /** base64url 原始密钥（放进 URL fragment，不发给服务端） */
  keyFragment: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return base64ToBytes(b64);
}

export async function encryptText(plaintext: string): Promise<EncryptResult> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return {
    ct: bytesToBase64(new Uint8Array(ctBuf)),
    iv: bytesToBase64(iv),
    keyFragment: toBase64Url(rawKey),
  };
}

export async function decryptText(ct: string, iv: string, keyFragment: string): Promise<string> {
  const rawKey = fromBase64Url(keyFragment);
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ct),
  );
  return decoder.decode(plainBuf);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/crypto.ts test/crypto.test.ts
git commit -m "feat: AES-GCM client-side crypto lib"
```

---

### Task 6: 高亮库 highlight.ts（TDD）

**Files:**
- Create: `frontend/src/lib/highlight.ts`
- Create: `test/highlight.test.ts`

- [ ] **Step 1: 写失败测试 test/highlight.test.ts**

```ts
import { highlight, langLabel } from "../frontend/src/lib/highlight";
import { describe, expect, it } from "vitest";

describe("highlight", () => {
  it("javascript 代码高亮为带 hljs class 的 span", () => {
    const html = highlight("const x = 1;", "javascript");
    expect(html).toContain("hljs");
  });

  it("plaintext 返回转义后的纯文本，无高亮标记", () => {
    const html = highlight("<script>", "plaintext");
    expect(html).toBe("&lt;script&gt;");
    expect(html).not.toContain("hljs");
  });

  it("未知语言回退为转义文本", () => {
    const html = highlight("<b>", "nope");
    expect(html).toBe("&lt;b&gt;");
  });

  it("langLabel 返回显示名", () => {
    expect(langLabel("vue")).toBe("Vue");
    expect(langLabel("plaintext")).toBe("纯文本");
    expect(langLabel("toml")).toBe("TOML");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bunx vitest run test/highlight.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 frontend/src/lib/highlight.ts**

按需注册语言，控制打包体积；hljs 的 ini 语法自带 toml 别名，toml 直接映射到 ini 规则；vue/html 共用 xml 规则：

```ts
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("yaml", yaml);

interface LangDef {
  hljsLang: string;
  label: string;
}

const LANG_MAP: Record<string, LangDef> = {
  javascript: { hljsLang: "javascript", label: "JavaScript" },
  python: { hljsLang: "python", label: "Python" },
  vue: { hljsLang: "xml", label: "Vue" },
  html: { hljsLang: "xml", label: "HTML" },
  css: { hljsLang: "css", label: "CSS" },
  json: { hljsLang: "json", label: "JSON" },
  ini: { hljsLang: "ini", label: "INI" },
  yaml: { hljsLang: "yaml", label: "YAML" },
  toml: { hljsLang: "ini", label: "TOML" },
  plaintext: { hljsLang: "", label: "纯文本" },
};

export function langLabel(lang: string): string {
  return LANG_MAP[lang]?.label ?? lang;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(code: string, lang: string): string {
  const hljsLang = LANG_MAP[lang]?.hljsLang;
  if (!hljsLang) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: hljsLang }).value;
  } catch {
    return escapeHtml(code);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/highlight.ts test/highlight.test.ts
git commit -m "feat: highlight.js language mapping"
```

---

### Task 7: 本地历史 history.ts

**Files:**
- Create: `frontend/src/lib/history.ts`

localStorage 仅在浏览器中存在，不做单元测试（无 localStorage 的 workerd/node 环境），由 Task 10 手动验收覆盖。

- [ ] **Step 1: 写 frontend/src/lib/history.ts**

```ts
export interface PasteRecord {
  id: string;
  /** URL fragment 中的密钥（base64url） */
  key: string;
  lang: string;
  created_at: number;
  expires_at: number | null;
}

const STORAGE_KEY = "worker_paster_history";
const MAX_RECORDS = 100;

export function loadHistory(): PasteRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is PasteRecord =>
        typeof v === "object" && v !== null && typeof (v as PasteRecord).id === "string",
    );
  } catch {
    return [];
  }
}

export function addHistory(rec: PasteRecord): void {
  const list = loadHistory().filter((r) => r.id !== rec.id);
  list.unshift(rec);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    // 存储满/隐私模式：忽略，历史功能非关键
  }
}

export function removeHistory(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadHistory().filter((r) => r.id !== id)));
  } catch {
    // 同上
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `bun --cwd=frontend run check`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/history.ts
git commit -m "feat: local paste history in localStorage"
```

---

### Task 8: 创建页 CreateView.vue

**Files:**
- Modify: `frontend/src/views/CreateView.vue`（替换占位内容）

- [ ] **Step 1: 写完整 CreateView.vue**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { encryptText } from "../lib/crypto";
import { addHistory, clearHistory, loadHistory, removeHistory, type PasteRecord } from "../lib/history";
import { langLabel } from "../lib/highlight";

const LANG_OPTIONS = [
  { value: "plaintext", label: "纯文本" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "vue", label: "Vue" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "ini", label: "INI" },
  { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" },
];

const EXPIRY_OPTIONS = [
  { value: "1h", label: "1 小时" },
  { value: "1d", label: "1 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "never", label: "永久" },
];

const EXPIRY_SECONDS: Record<string, number | null> = {
  "1h": 3600,
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  never: null,
};

const MAX_TEXT_BYTES = 1024 * 1024;

const text = ref("");
const lang = ref("plaintext");
const expiry = ref("7d");
const creating = ref(false);
const error = ref("");
const shareLink = ref("");
const history = ref<PasteRecord[]>(loadHistory());
const showHistory = ref(false);

const textBytes = computed(() => new TextEncoder().encode(text.value).length);

function expiresAtOf(expiry: string): number | null {
  const ttl = EXPIRY_SECONDS[expiry];
  return ttl === null || ttl === undefined ? null : Date.now() + ttl * 1000;
}

async function create(): Promise<void> {
  error.value = "";
  shareLink.value = "";
  if (!text.value) {
    error.value = "内容不能为空";
    return;
  }
  if (textBytes.value > MAX_TEXT_BYTES) {
    error.value = "内容超过 1MB 上限";
    return;
  }
  creating.value = true;
  try {
    const { ct, iv, keyFragment } = await encryptText(text.value);
    const res = await fetch("/api/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ct, iv, lang: lang.value, expiry: expiry.value }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `创建失败（${res.status}）`);
    }
    const { id } = (await res.json()) as { id: string };
    shareLink.value = `${location.origin}/${id}#${keyFragment}`;
    addHistory({
      id,
      key: keyFragment,
      lang: lang.value,
      created_at: Date.now(),
      expires_at: expiresAtOf(expiry.value),
    });
    history.value = loadHistory();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    creating.value = false;
  }
}

async function copyShareLink(): Promise<void> {
  await navigator.clipboard.writeText(shareLink.value);
}

function fullLink(rec: PasteRecord): string {
  return `${location.origin}/${rec.id}#${rec.key}`;
}

function fmtTime(ts: number | null): string {
  return ts === null ? "永久" : new Date(ts).toLocaleString();
}

function removeOne(id: string): void {
  removeHistory(id);
  history.value = loadHistory();
}

function clearAll(): void {
  clearHistory();
  history.value = loadHistory();
}
</script>

<template>
  <div class="container">
    <h1>worker_paster</h1>
    <p class="muted">零知识云粘贴板：内容在本地加密，服务器只存密文。</p>

    <textarea v-model="text" placeholder="粘贴要分享的文本或代码…"></textarea>

    <div class="row">
      <select v-model="lang" aria-label="语言类型">
        <option v-for="o in LANG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select v-model="expiry" aria-label="过期时间">
        <option v-for="o in EXPIRY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button class="primary" :disabled="creating" @click="create">
        {{ creating ? "创建中…" : "创建链接" }}
      </button>
      <span class="muted">{{ textBytes }} / 1048576 字节</span>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="shareLink" class="link-box">
      <div>{{ shareLink }}</div>
      <div class="row">
        <button @click="copyShareLink">复制链接</button>
        <span class="muted">密钥在 # 后面，服务器看不到；链接丢失无法找回。</span>
      </div>
    </div>

    <div v-if="history.length" class="history">
      <div class="row">
        <button @click="showHistory = !showHistory">我的记录（{{ history.length }}）</button>
        <button v-if="showHistory" @click="clearAll">清空</button>
      </div>
      <template v-if="showHistory">
        <ul>
          <li v-for="rec in history" :key="rec.id">
            <a :href="fullLink(rec)">{{ fullLink(rec) }}</a>
            <span class="muted"> — {{ langLabel(rec.lang) }} · 过期：{{ fmtTime(rec.expires_at) }}</span>
            <button @click="removeOne(rec.id)">删除</button>
          </li>
        </ul>
        <p class="muted">记录仅保存在本浏览器。</p>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 构建与类型检查**

Run: `bun --cwd=frontend run check`
Expected: 无错误。

Run: `bun --cwd=frontend run build`
Expected: 构建成功。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CreateView.vue
git commit -m "feat: create view with encryption and share link"
```

---

### Task 9: 查看页 ViewView.vue

**Files:**
- Modify: `frontend/src/views/ViewView.vue`（替换占位内容）

- [ ] **Step 1: 写完整 ViewView.vue**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { decryptText } from "../lib/crypto";
import { highlight, langLabel } from "../lib/highlight";

type State = "loading" | "ready" | "nokey" | "notfound" | "decrypterror" | "network";

const route = useRoute();
const state = ref<State>("loading");
const text = ref("");
const lang = ref("plaintext");
const createdAt = ref<number | null>(null);
const expiresAt = ref<number | null>(null);

const lineCount = computed(() => text.value.split("\n").length);
const html = computed(() => highlight(text.value, lang.value));

onMounted(load);

async function load(): Promise<void> {
  state.value = "loading";
  const id = String(route.params.id ?? "");
  const key = route.hash.replace(/^#/, "");
  if (!key) {
    state.value = "nokey";
    return;
  }
  try {
    const res = await fetch(`/api/get/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      state.value = "notfound";
      return;
    }
    if (!res.ok) {
      state.value = "network";
      return;
    }
    const data = (await res.json()) as {
      ct: string;
      iv: string;
      lang: string;
      created_at: number;
      expires_at: number | null;
    };
    lang.value = data.lang;
    createdAt.value = data.created_at;
    expiresAt.value = data.expires_at;
    try {
      text.value = await decryptText(data.ct, data.iv, key);
    } catch {
      state.value = "decrypterror";
      return;
    }
    state.value = "ready";
  } catch {
    state.value = "network";
  }
}

async function copyText(): Promise<void> {
  await navigator.clipboard.writeText(text.value);
}

function fmtTime(ts: number | null): string {
  return ts === null ? "永久" : new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="container">
    <p v-if="state === 'loading'" class="muted">加载中…</p>

    <div v-else-if="state === 'nokey'" class="error">
      链接不完整：缺少 # 后面的密钥，无法解密。
    </div>

    <div v-else-if="state === 'notfound'" class="error">粘贴不存在或已过期。</div>

    <div v-else-if="state === 'decrypterror'" class="error">
      解密失败：链接可能不完整或已损坏。
    </div>

    <div v-else-if="state === 'network'" class="error">
      网络错误。
      <button @click="load">重试</button>
    </div>

    <template v-else-if="state === 'ready'">
      <div class="row">
        <strong>{{ langLabel(lang) }}</strong>
        <span class="muted">
          创建于 {{ fmtTime(createdAt) }} · 过期：{{ fmtTime(expiresAt) }}
        </span>
        <button @click="copyText">复制原文</button>
      </div>
      <div class="code-wrap">
        <div class="gutter">
          <span v-for="n in lineCount" :key="n">{{ n }}</span>
        </div>
        <pre class="code"><code v-html="html"></code></pre>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: 构建与类型检查**

Run: `bun --cwd=frontend run check`
Expected: 无错误。

Run: `bun --cwd=frontend run build`
Expected: 构建成功。

- [ ] **Step 3: 运行全部自动化测试**

Run: `bun run test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ViewView.vue
git commit -m "feat: view page with decryption, highlight and line numbers"
```

---

### Task 10: README、手动验收与部署说明

**Files:**
- Modify: `README.md`（替换占位内容）

- [ ] **Step 1: 写 README.md**

```markdown
# worker_paster

部署在 Cloudflare Workers 上的零知识云粘贴板：把文本/代码变成一个可分享的链接。

- **零知识**：内容在浏览器端 AES-256-GCM 加密，密钥只在链接 `#` 后的 fragment 里，服务器只存密文
- **自动过期**：1 小时 / 1 天 / 7 天 / 30 天 / 永久，KV TTL 到期自动删除
- **代码高亮**：JavaScript / Python / Vue / HTML / CSS / JSON / INI / YAML / TOML / 纯文本
- **简约**：无账号、无管理面板；创建过的链接保存在浏览器本地

## 环境要求

- [bun](https://bun.sh) ≥ 1.1（包管理器与脚本入口）
- Node.js ≥ 20（vitest / wrangler 运行时）
- 一个 Cloudflare 账号（部署时需要 `wrangler login`）

## 本地开发

```bash
# 1. 安装依赖（workspaces 一次装好根与 frontend）
bun install

# 2. 构建前端（wrangler dev 需要 frontend/dist 存在）
bun run build

# 3. 启动 Worker（API + 静态资源，http://127.0.0.1:8787）
bun run dev
```

只调前端样式时，可另开一个终端跑 `bun --cwd=frontend run dev`（Vite dev server，`/api` 自动代理到 8787）。

## 测试

```bash
bun run test                      # Worker API + 加密 + 高亮 + 静态资源冒烟（vitest-pool-workers）
bun run check                     # Worker 端类型检查
bun --cwd=frontend run check      # 前端类型检查
```

注意：不要用 `bun test`（bun 自带测试器与本项目 vitest 配置不兼容），一律 `bun run test`。fresh clone 上首次跑测试前先 `bun run build`（assets 冒烟测试需要 `frontend/dist` 存在）。

## 部署

```bash
bunx wrangler login
bunx wrangler kv namespace create PASTES
# 把命令输出的 id 填入 wrangler.toml 的 kv_namespaces.id
bun run deploy        # 构建前端 + wrangler deploy
```

部署后访问 workers.dev 域名即可使用，也可在 Cloudflare 控制台绑定自定义域名。

## 隐私说明

- 服务器只能看到：密文、IV、语言类型、创建/过期时间
- 链接 `#` 后的密钥不会发送到服务器（fragment 不进 HTTP 请求）
- 链接丢失 = 内容永久无法找回，服务器没有副本
```

- [ ] **Step 2: 手动验收（wrangler dev 起本地环境）**

后台运行 `bun run dev`，按规格 §10 清单逐项验收：

1. 浏览器打开 `http://127.0.0.1:8787/` → 输入一段 JavaScript 代码，语言选 JavaScript，过期选 1 天，点创建 → 显示分享链接
2. 打开分享链接 → 内容一致、高亮正确、行号显示、复制原文可用
3. 把同一链接去掉 `#` 及其后内容再打开 → 提示"链接不完整，缺少密钥"
4. 篡改 fragment 一个字符再打开 → 提示"解密失败"
5. 打开 `http://127.0.0.1:8787/zzzzzzzz#x` → 提示"粘贴不存在或已过期"
6. 换语言类型（vue/html/json/ini/toml/yaml/plaintext）各创建一次并打开，高亮抽查正常
7. 首页"我的记录"显示刚创建的记录，删除/清空生效
8. 超长内容（>1MB）创建 → 前端提示超过上限

curl 辅助验收（解密是浏览器行为，1-6 需真实浏览器）：

Run: `curl -s http://127.0.0.1:8787/api/get/00000000`
Expected: `{"error":"粘贴不存在或已过期"}`

- [ ] **Step 3: 验收问题全部修复后，运行全量测试**

Run: `bun run test && bun run check && bun --cwd=frontend run check`
Expected: 全部通过。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with dev, test and deploy instructions"
```

- [ ] **Step 5: （用户操作）真实部署**

需要 Cloudflare 账号登录，由用户执行：

```bash
bunx wrangler login
bunx wrangler kv namespace create PASTES
# 编辑 wrangler.toml：id 替换为真实 namespace id
bun run deploy
```

部署后在线上按 Task 10 Step 2 的清单 1-6 再走一遍（线上域名）。

---

## 计划自审记录

- **规格覆盖**：§3 架构（Task 1/4）、§4 数据模型（Task 2）、§5 加密（Task 5/8/9）、§6 API（Task 2/3）、§7 前端两页+高亮+记录（Task 4/6/7/8/9）、§8 错误处理（Task 2/3/9）、§10 测试（各 Task 内 TDD + Task 10 手动验收）、§11 部署（Task 10）。无遗漏。
- **占位符扫描**：无 TBD/TODO；所有代码步骤给出完整代码。
- **类型一致性**：`PasteRecord`（id/key/lang/created_at/expires_at）在 Task 7 定义、Task 8 使用一致；`EncryptResult`（ct/iv/keyFragment）在 Task 5 定义、Task 8/9 使用一致；KV record 字段（v/ct/iv/lang/created_at/expires_at）在 Task 2 定义、Task 3/9 使用一致。
