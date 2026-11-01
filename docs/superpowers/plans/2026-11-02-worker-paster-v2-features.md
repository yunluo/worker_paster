# worker_paster v2 功能实现计划（Markdown 渲染 / 二维码 / 自定义 ID / 下载）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已上线的零知识粘贴板追加 4 个功能：Markdown 渲染、创建页二维码、自定义 ID（自定义即唯一 ID）、查看页下载为文件。

**Architecture:** 自定义 ID 与 markdown 语言都是 Worker 端白名单/校验的增量，KV value 结构不变、无迁移；前端新增 `lib/markdown.ts`（markdown-it，`html:false` 防 XSS）与 `lib/download.ts`（扩展名映射 + Blob 下载）两个纯函数模块，视图层做小改。

**Tech Stack:** Cloudflare Workers + KV、Vue 3 + Vite、markdown-it（`html: false`）、qrcode（本地 dataURL，绝不走外部 API）、vitest + @cloudflare/vitest-pool-workers。

**Spec:** `docs/superpowers/specs/2026-11-02-worker-paster-v2-features-design.md`

---

## 全局注意事项（每个子代理开工前必读）

- 工作目录：`D:\Python_Work\worker_paster`，Windows cmd shell，**搜索一律用 `rg`**。
- 包管理器是 bun：安装 `bun install`，脚本一律 `bun run <script>`。**严禁 `bun test`**（bun 自带测试器与 vitest-pool-workers 不兼容）。
- 跨目录跑脚本必须用**等号形式**：`bun --cwd=frontend run check`（空格形式 `bun --cwd frontend ...` 在 Windows bun 1.4.4 上只打印帮助）。
- 测试全部跑 `bun run test`（全套很快，无需 -t 过滤）；fresh clone 场景不适用（仓库已有 dist 可不管，若 assets 冒烟测试报缺目录先 `bun run build`）。
- vitest-pool-workers 在 Windows 上偶发 miniflare EBUSY 报错属环境噪音，重跑即可；启动日志出现 `[mf:warn]` compat-date 提示是已接受的偏差，勿"修复"。
- `wrangler.toml` 有用户本地改动（KV id），**不要提交、不要还原**，别碰它。
- 新前端依赖在 `frontend/` 子包：`bun add --cwd=frontend <pkg>`、开发依赖 `bun add --cwd=frontend --dev <pkg>`。
- 前端无组件测试设施，视图层改动靠 `bun --cwd=frontend run check`（vue-tsc）+ `bun run build` + 浏览器手动验收兜底。

---

### Task 1: 分支与新依赖

**Files:**
- Modify: `frontend/package.json`（由 bun add 修改）
- Modify: `bun.lock`

- [ ] **Step 1: 建功能分支**

```bash
git checkout -b feat/v2-features
```

- [ ] **Step 2: 安装运行时依赖**

```bash
bun add --cwd=frontend markdown-it qrcode
bun add --cwd=frontend --dev @types/markdown-it @types/qrcode
```

预期：`frontend/package.json` dependencies 出现 `markdown-it`（^14）、`qrcode`（^1.5），devDependencies 出现两个 `@types/*`。

- [ ] **Step 3: 构建冒烟验证**

```bash
bun run build
```

预期：vite 构建成功，`frontend/dist` 更新。

- [ ] **Step 4: 提交**

```bash
git add frontend/package.json bun.lock
git commit -m "chore: add markdown-it and qrcode dependencies"
```

---

### Task 2: Worker 自定义 ID（TDD）

**Files:**
- Modify: `src/index.ts`
- Test: `test/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `test/api.test.ts` 的 `describe("POST /api/new", ...)` 内追加：

```ts
  it("自定义 ID 创建成功并可读回", async () => {
    const res = await post({ ...VALID_BODY, id: "my-config" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toBe("my-config");

    const get = await SELF.fetch("https://example.com/api/get/my-config");
    expect(get.status).toBe(200);
    const record = (await get.json()) as Record<string, unknown>;
    expect(record.lang).toBe("javascript");
  });

  it("id 为空字符串时走随机 ID", async () => {
    const res = await post({ ...VALID_BODY, id: "" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it("自定义 ID 含非法字符返回 400", async () => {
    for (const bad of ["bad id", "点", "a.b", "bad/id"]) {
      const res = await post({ ...VALID_BODY, id: bad });
      expect(res.status).toBe(400);
    }
  });

  it("自定义 ID 过短或过长返回 400", async () => {
    expect((await post({ ...VALID_BODY, id: "ab" })).status).toBe(400);
    expect((await post({ ...VALID_BODY, id: "a".repeat(33) })).status).toBe(400);
  });

  it("保留字 api / assets 返回 400", async () => {
    expect((await post({ ...VALID_BODY, id: "api" })).status).toBe(400);
    expect((await post({ ...VALID_BODY, id: "assets" })).status).toBe(400);
  });

  it("同 ID 二次创建返回 409", async () => {
    expect((await post({ ...VALID_BODY, id: "taken-id" })).status).toBe(200);
    const res = await post({ ...VALID_BODY, id: "taken-id" });
    expect(res.status).toBe(409);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("该 ID 已被占用");
  });
```

在 `describe("GET /api/get/:id", ...)` 内：把现有用例 `it("9 位 ID 返回 404")` 与 `it("合法前缀但超长的 ID 不返回记录")` 替换为（语义变化：3–32 位 ID 现在命中 API 路由，404 是业务体）：

```ts
  it("9 位 ID 命中 API 路由并返回业务 404", async () => {
    const res = await SELF.fetch("https://example.com/api/get/abcdefghi");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "粘贴不存在或已过期" });
  });

  it("合法前缀但超长的 ID 不返回记录", async () => {
    await env.PASTES.put(
      "abcd1234",
      JSON.stringify({ v: 1, ct: "x", iv: "y", lang: "json", created_at: 1, expires_at: 2 }),
    );
    // 若正则丢失 $ 锚点，/api/get/abcd12345 会截短命中记录，此用例防回归
    const res = await SELF.fetch("https://example.com/api/get/abcd12345");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "粘贴不存在或已过期" });
  });

  it("3 位 ID 命中 API 路由", async () => {
    const res = await SELF.fetch("https://example.com/api/get/abc");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "粘贴不存在或已过期" });
  });

  it("超过 32 位的 ID 走通用兜底 404", async () => {
    const res = await SELF.fetch(`https://example.com/api/get/${"a".repeat(33)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not found" });
  });
```

原 `it("格式非法的 ID 返回 404")`（`short!`）保持不变（含 `!` 不匹配新正则，仍走通用兜底）。

- [ ] **Step 2: 运行测试确认失败**

```bash
bun run test
```

预期：新增用例 FAIL（自定义 ID 被忽略返回随机 ID / GET 9 位 ID 断言业务体失败等）。

- [ ] **Step 3: 实现**

`src/index.ts` 修改点：

① 常量区（`ID_LENGTH` 之后）加：

```ts
// 自定义 ID：3–32 位，字母/数字/-/_；api 与 assets 与 Worker 路由、静态资源目录冲突
const CUSTOM_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED_IDS = new Set(["api", "assets"]);
```

② `POST /api/new` 解构处，把

```ts
      const { ct, iv, lang, expiry } = body as Record<string, unknown>;
```

改为

```ts
      const { ct, iv, lang, expiry, id: rawId } = body as Record<string, unknown>;
```

并在 `expiry` 白名单校验之后、base64 解码之前插入：

```ts
      const requestedId = typeof rawId === "string" && rawId !== "" ? rawId : null;
      if (requestedId !== null) {
        if (!CUSTOM_ID_RE.test(requestedId)) {
          return json({ error: "自定义 ID 只能包含字母、数字、-、_，长度 3–32" }, 400);
        }
        if (RESERVED_IDS.has(requestedId)) {
          return json({ error: "该 ID 为保留字，请换一个" }, 400);
        }
      }
```

③ 写入段：把现有 `for` 循环整体改为（先处理自定义 ID，随机逻辑保持原样；`options` 提到循环外复用）：

```ts
      const options = ttl === null ? undefined : { expirationTtl: ttl };
      if (requestedId !== null) {
        // get→put 非原子，极小并发窗口可接受（内部 ≤10 人使用，spec §3 已注明）
        if ((await env.PASTES.get(requestedId)) !== null) {
          return json({ error: "该 ID 已被占用" }, 409);
        }
        await env.PASTES.put(requestedId, JSON.stringify(record), options);
        return json({ id: requestedId });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = randomId();
        if ((await env.PASTES.get(id)) !== null) continue; // ID 碰撞重试
        await env.PASTES.put(id, JSON.stringify(record), options);
        return json({ id });
      }
      return json({ error: "ID 生成冲突，请重试" }, 500);
```

④ `GET` 路由正则，把

```ts
    const getMatch = url.pathname.match(/^\/api\/get\/([0-9A-Za-z]{8})$/);
```

改为

```ts
    const getMatch = url.pathname.match(/^\/api\/get\/([A-Za-z0-9_-]{3,32})$/);
```

- [ ] **Step 4: 运行测试确认全绿**

```bash
bun run test
```

预期：全部 PASS（含原有 34 条与新增用例）。

- [ ] **Step 5: 提交**

```bash
git add src/index.ts test/api.test.ts
git commit -m "feat: optional custom paste ID (3-32 chars, reserved words, 409 on conflict)"
```

---

### Task 3: Worker 语言白名单加 markdown（TDD）

**Files:**
- Modify: `src/index.ts`
- Test: `test/api.test.ts`

- [ ] **Step 1: 写失败测试**

`test/api.test.ts` 的 `describe("POST /api/new", ...)` 内追加：

```ts
  it("lang markdown 创建成功", async () => {
    const res = await post({ ...VALID_BODY, lang: "markdown" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const record = JSON.parse((await env.PASTES.get(id))!) as Record<string, unknown>;
    expect(record.lang).toBe("markdown");
  });
```

- [ ] **Step 2: 运行确认失败**

```bash
bun run test
```

预期：该用例 FAIL（400 不支持的语言类型）。

- [ ] **Step 3: 实现**

`src/index.ts` 的 `LANGS` 集合追加 `"markdown"`（放在 `"toml"` 之后、`"plaintext"` 之前）。

- [ ] **Step 4: 运行确认全绿**

```bash
bun run test
```

- [ ] **Step 5: 提交**

```bash
git add src/index.ts test/api.test.ts
git commit -m "feat: accept markdown language"
```

---

### Task 4: lib/markdown.ts（渲染器 + 测试）

**Files:**
- Create: `frontend/src/lib/markdown.ts`
- Modify: `frontend/src/lib/highlight.ts`（导出 escapeHtml、LANG_MAP 加 markdown）
- Test: `test/markdown.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `test/markdown.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../frontend/src/lib/markdown";

describe("renderMarkdown", () => {
  it("渲染标题/列表/加粗", () => {
    const html = renderMarkdown("# 标题\n\n- 项目一\n- 项目二\n\n**加粗**");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<strong>加粗</strong>");
  });

  it("渲染表格", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("原始 HTML 被转义（html:false 防 XSS）", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">d</div>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<div");
    expect(html).toContain("&lt;script&gt;");
  });

  it("链接渲染并带 href", () => {
    const html = renderMarkdown("[示例](https://example.com)");
    expect(html).toContain('<a href="https://example.com">示例</a>');
  });

  it("围栏代码按语言高亮（含 js 别名）", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("hljs-");
  });

  it("未注册围栏语言转义显示", () => {
    const html = renderMarkdown("```\n<b>&raw</b>\n```");
    expect(html).toContain("&lt;b&gt;");
  });

  it("超过 256KB 返回空串（调用方退回纯文本视图）", () => {
    const big = "# t\n" + "段".repeat(256 * 1024);
    expect(renderMarkdown(big)).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun run test
```

预期：`test/markdown.test.ts` 整体 FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`frontend/src/lib/highlight.ts` 两处小改：

① `escapeHtml` 加 `export`（`function escapeHtml` → `export function escapeHtml`）。

② `LANG_MAP` 在 `toml` 项后加：

```ts
  markdown: { hljsLang: "", label: "Markdown" },
```

（`hljsLang: ""` → `highlight()` 对 markdown 自然走转义路径，供超限退化使用；正常渲染走 markdown.ts。）

新建 `frontend/src/lib/markdown.ts`：

```ts
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import { MAX_HIGHLIGHT_CHARS, escapeHtml } from "./highlight";

// 代码围栏常见缩写 → highlight.ts 已注册的 hljs 语言
const FENCE_ALIAS: Record<string, string> = {
  js: "javascript",
  py: "python",
};

const md = new MarkdownIt({
  html: false, // 原始 HTML 一律转义，防 XSS
  linkify: true,
  highlight(code, lang) {
    const mapped = FENCE_ALIAS[lang] ?? lang;
    if (code.length <= MAX_HIGHLIGHT_CHARS) {
      try {
        return hljs.highlight(code, { language: mapped }).value;
      } catch {
        // 未注册语言：转义显示
      }
    }
    return escapeHtml(code);
  },
});

// 超过阈值返回空串，调用方退回纯文本代码视图（与高亮阈值同一防线）
export function renderMarkdown(source: string): string {
  if (source.length > MAX_HIGHLIGHT_CHARS) return "";
  return md.render(source);
}
```

注意：`highlight.ts` 顶部已 `hljs.registerLanguage(...)` 七种语言，markdown.ts 只 import core 实例复用注册表，不重复注册。

- [ ] **Step 4: 运行确认全绿**

```bash
bun run test
```

预期：markdown 用例全部 PASS（markdown-it 在 workerd 下可运行；若此处因环境报模块解析错误，**停下来报告**，不得擅自换渲染库）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/markdown.ts frontend/src/lib/highlight.ts test/markdown.test.ts
git commit -m "feat: markdown renderer (markdown-it, html escaped, fence highlighting)"
```

---

### Task 5: lib/download.ts（扩展名映射 + 下载 + 测试）

**Files:**
- Create: `frontend/src/lib/download.ts`
- Test: `test/download.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `test/download.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { extFor, fileNameFor } from "../frontend/src/lib/download";

describe("download 扩展名映射", () => {
  it("每种语言映射到正确扩展名", () => {
    expect(extFor("javascript")).toBe("js");
    expect(extFor("python")).toBe("py");
    expect(extFor("vue")).toBe("vue");
    expect(extFor("css")).toBe("css");
    expect(extFor("html")).toBe("html");
    expect(extFor("json")).toBe("json");
    expect(extFor("ini")).toBe("ini");
    expect(extFor("yaml")).toBe("yml");
    expect(extFor("toml")).toBe("toml");
    expect(extFor("markdown")).toBe("md");
    expect(extFor("plaintext")).toBe("txt");
  });

  it("未知语言回退 txt", () => {
    expect(extFor("rust")).toBe("txt");
  });

  it("文件名为 id.ext", () => {
    expect(fileNameFor("my-config", "markdown")).toBe("my-config.md");
    expect(fileNameFor("Ab3xY9kQ", "javascript")).toBe("Ab3xY9kQ.js");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
bun run test
```

- [ ] **Step 3: 实现**

新建 `frontend/src/lib/download.ts`：

```ts
const EXT_MAP: Record<string, string> = {
  javascript: "js",
  python: "py",
  vue: "vue",
  css: "css",
  html: "html",
  json: "json",
  ini: "ini",
  yaml: "yml",
  toml: "toml",
  markdown: "md",
  plaintext: "txt",
};

export function extFor(lang: string): string {
  return EXT_MAP[lang] ?? "txt";
}

export function fileNameFor(id: string, lang: string): string {
  return `${id}.${extFor(lang)}`;
}

// 浏览器端下载解密后的源文；仅在被视图层调用时执行（无单测，走手动验收）
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 运行确认全绿**

```bash
bun run test
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/download.ts test/download.test.ts
git commit -m "feat: download paste as file with per-language extension"
```

---

### Task 6: 创建页——自定义 ID 输入 + 二维码

**Files:**
- Modify: `frontend/src/views/CreateView.vue`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: script 部分修改**

`CreateView.vue` 的 `<script setup>` 中：

① import 区追加：

```ts
import QRCode from "qrcode";
```

② `LANG_OPTIONS` 在 `{ value: "toml", label: "TOML" }` 后追加：

```ts
  { value: "markdown", label: "Markdown" },
```

③ 状态区（`showHistory` 之前）追加：

```ts
const CUSTOM_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED_IDS = new Set(["api", "assets"]);
const customId = ref("");
const qr = ref("");
```

④ `create()` 内，`textBytes` 上限校验之后追加：

```ts
  const requestedId = customId.value.trim();
  if (requestedId) {
    if (!CUSTOM_ID_RE.test(requestedId)) {
      error.value = "自定义 ID 只能包含字母、数字、-、_，长度 3–32";
      return;
    }
    if (RESERVED_IDS.has(requestedId)) {
      error.value = "该 ID 为保留字（api / assets），请换一个";
      return;
    }
  }
```

并把函数开头 `shareLink.value = "";` 下一行加 `qr.value = "";`。

⑤ 请求体改为：

```ts
      body: JSON.stringify({
        ct,
        iv,
        lang: lang.value,
        expiry: expiry.value,
        ...(requestedId ? { id: requestedId } : {}),
      }),
```

⑥ `shareLink.value = \`${location.origin}/${id}#${keyFragment}\`;` 之后追加（二维码失败不阻塞分享）：

```ts
    try {
      qr.value = await QRCode.toDataURL(shareLink.value, { width: 160, margin: 1 });
    } catch {
      qr.value = "";
    }
```

409/400 错误无需新代码：现有 `if (!res.ok)` 分支已取 `data.error` 抛出展示，textarea 与 ID 输入自然保留，改 ID 可直接重试。

- [ ] **Step 2: template 部分修改**

① textarea 之后、语言选择 `.row` 之前插入：

```html
    <input
      v-model="customId"
      class="id-input"
      aria-label="自定义 ID（可选）"
      placeholder="自定义 ID（可选，3–32 位字母/数字/-/_）"
    />
```

② `.link-box` 整块改为：

```html
    <div v-if="shareLink" class="link-box">
      <img v-if="qr" :src="qr" alt="分享链接二维码" width="160" height="160" />
      <div>{{ shareLink }}</div>
      <div class="row">
        <button @click="copyShareLink">复制链接</button>
        <span class="muted">密钥在 # 后面，服务器看不到；链接丢失无法找回。</span>
      </div>
    </div>
```

- [ ] **Step 3: style.css 追加样式**

文件末尾追加：

```css
.id-input {
  display: block;
  width: 100%;
  margin: 12px 0 0;
  padding: 8px 12px;
  font: inherit;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--fg);
}

.link-box img {
  display: block;
  margin-bottom: 8px;
  border-radius: 8px;
}
```

- [ ] **Step 4: 类型检查 + 构建验证**

```bash
bun --cwd=frontend run check
bun run build
bun run test
```

预期：三项全部通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/CreateView.vue frontend/src/style.css
git commit -m "feat: custom ID input and QR code on create page"
```

---

### Task 7: 查看页——markdown 渲染分支 + 下载按钮

**Files:**
- Modify: `frontend/src/views/ViewView.vue`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: script 部分修改**

`ViewView.vue` 的 `<script setup>` 中：

① import 区追加（原 `import { highlight, langLabel } from "../lib/highlight";` 一行改为）：

```ts
import { highlight, langLabel } from "../lib/highlight";
import { renderMarkdown } from "../lib/markdown";
import { downloadText, fileNameFor } from "../lib/download";
```

② `html` computed 之后追加：

```ts
const isMarkdown = computed(() => lang.value === "markdown");
// renderMarkdown 超过阈值返回 ""，此时回落到下方纯文本代码视图
const mdHtml = computed(() => (isMarkdown.value ? renderMarkdown(text.value) : ""));
```

③ `copyText` 函数之后追加：

```ts
function download(): void {
  const id = String(route.params.id ?? "paste");
  downloadText(fileNameFor(id, lang.value), text.value);
}
```

- [ ] **Step 2: template 部分修改**

`state === 'ready'` 分支：`.row` 操作区在「复制原文」按钮后加「下载」按钮；`code-wrap` 外层套 markdown 条件。整块替换为：

```html
    <template v-else-if="state === 'ready'">
      <div class="row">
        <strong>{{ langLabel(lang) }}</strong>
        <span class="muted">
          创建于 {{ fmtTime(createdAt) }} · 过期：{{ fmtTime(expiresAt) }}
        </span>
        <button @click="copyText">复制原文</button>
        <button @click="download">下载</button>
      </div>
      <div v-if="mdHtml" class="markdown-body" v-html="mdHtml"></div>
      <div v-else class="code-wrap">
        <div class="gutter">
          <span v-for="n in lineCount" :key="n">{{ n }}</span>
        </div>
        <pre class="code"><code v-html="html"></code></pre>
      </div>
    </template>
```

（复制按钮对 Markdown 复制的本就是解密后的源文，行为不变。）

- [ ] **Step 3: style.css 追加 .markdown-body**

文件末尾追加（跟随现有深浅色 CSS 变量，不引外部主题）：

```css
/* Markdown 渲染视图 */
.markdown-body {
  line-height: 1.6;
  overflow-wrap: break-word;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  line-height: 1.3;
  margin: 1.2em 0 0.6em;
}

.markdown-body h1,
.markdown-body h2 {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border);
}

.markdown-body code {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 90%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}

.markdown-body pre {
  background: #0d1117;
  color: #e6edf3;
  border-radius: 8px;
  padding: 12px;
  overflow: auto;
}

.markdown-body pre code {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font-size: 14px;
}

.markdown-body table {
  border-collapse: collapse;
  margin: 12px 0;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border);
  padding: 6px 12px;
}

.markdown-body blockquote {
  margin: 12px 0;
  padding: 0 12px;
  border-left: 4px solid var(--border);
  color: var(--muted);
}

.markdown-body a {
  color: var(--accent);
}

.markdown-body img {
  max-width: 100%;
}
```

- [ ] **Step 4: 类型检查 + 构建验证**

```bash
bun --cwd=frontend run check
bun run build
bun run test
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/ViewView.vue frontend/src/style.css
git commit -m "feat: markdown rendering and file download on view page"
```

---

### Task 8: README 更新 + 全量回归 + 浏览器手动验收

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 功能清单更新**

README 开头功能列表改为：

```markdown
- **零知识**：内容在浏览器端 AES-256-GCM 加密，密钥只在链接 `#` 后的 fragment 里，服务器只存密文
- **自动过期**：1 小时 / 1 天 / 7 天 / 30 天 / 永久，KV TTL 到期自动删除
- **代码高亮**：JavaScript / Python / Vue / HTML / CSS / JSON / INI / YAML / TOML / 纯文本
- **Markdown 渲染**：语言选 Markdown 时渲染为 HTML 展示（原始 HTML 一律转义）
- **自定义 ID**：创建时可自选链接路径（如 `/my-config`），重复自动提示
- **二维码与下载**：创建后扫码即开；查看页一键下载为对应扩展名的文件
- **简约**：无账号、无管理面板；创建过的链接保存在浏览器本地
```

并在「隐私说明」末尾追加一行：

```markdown
- 二维码在浏览器本地生成，链接（含密钥）不经过任何第三方服务
```

- [ ] **Step 2: 全量回归**

```bash
bun run test
bun run check
bun --cwd=frontend run check
bun run build
```

预期：测试全绿、两个类型检查零错误、构建成功。

- [ ] **Step 3: 浏览器手动验收（`bun run dev` 后用浏览器自动化逐项验证）**

1. 选 Markdown 粘贴一段含标题/表格/代码围栏/`<script>` 的文本 → 创建 → 打开链接：渲染为 HTML，`<script>` 显示为字面量，围栏代码有高亮
2. 创建成功区出现二维码 → 用浏览器打开二维码图片对比 URL，或扫描确认指向完整链接（含 `#` 密钥）
3. 填自定义 ID `my-test-01` 创建 → 访问 `/my-test-01#key` 可正常解密；同 ID 再创建 → 页面提示「该 ID 已被占用」，内容与 ID 保留可改后重试
4. 保留字 `api` → 前端提交时报错，无网络请求（Network 面板确认）
5. 查看页点「下载」→ 各语言文件名扩展名正确（js/py/md/txt…），内容与原文一致
6. 老随机 ID 链接回归：历史记录里的旧链接打开正常
7. 超大 Markdown（>256KB）退化为等宽纯文本视图，不卡死

- [ ] **Step 4: 提交 + 汇报**

```bash
git add README.md
git commit -m "docs: README features for v2 (markdown, QR, custom ID, download)"
```

全部通过后汇报：提交列表、测试数、验收结果。分支收尾（合并回 main）由主会话按用户既定偏好执行。

---

## 风险与备注

- **markdown-it 在 workerd 测试环境**：纯 JS 实现，预期可直接运行；若 Task 4 出现模块解析/运行时错误，停下来上报，不得擅自换成 marked（spec 已定选型）。
- **自定义 ID 可枚举性**：枚举者只能拿到密文（无 fragment 密钥不可解密），spec §3 已评估接受。
- **get→put 非原子**：同毫秒并发同 ID 极小概率双双成功；内部使用接受，spec §3 已注明。
- **二维码硬约束**：只允许本地 `qrcode` 库生成，任何外部 API 调用都等于泄露密钥，review 时重点盯这一点。
