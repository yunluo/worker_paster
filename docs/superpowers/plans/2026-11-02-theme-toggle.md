# 夜间模式（三态主题切换）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两页提供 浅色→深色→跟随系统 三态主题切换，localStorage 持久、即时生效、首屏不闪。

**Architecture:** 纯前端增量：`lib/theme.ts` 薄封装（localStorage + `<html data-theme>`），CSS 变量块按 `data-theme` 选择器重组（未设时系统跟随，与现状一致），`ThemeToggle.vue` 单按钮循环。零后端改动。

**Tech Stack:** Vue 3 SFC、原生 CSS 变量、localStorage、vitest（workerd，仅纯函数）。

**Spec:** `docs/superpowers/specs/2026-11-02-theme-toggle-design.md`

---

## 全局注意事项

- 工作目录 `D:\Python_Work\worker_paster`，Windows cmd，搜索用 `rg`；bun 脚本一律 `bun run <script>`，**严禁 `bun test`**；前端类型检查用等号形式 `bun --cwd=frontend run check`。
- `wrangler.toml` 已跟踪（真实 KV id），不要修改。
- miniflare EBUSY / `[mf:warn]` compat-date 为已记录的 Windows 噪音。
- 当前基线：main @ 1349f8b，55/55 测试。

---

### Task 1: 分支 + lib/theme.ts（TDD）

**Files:**
- Create: `frontend/src/lib/theme.ts`
- Test: `test/theme.test.ts`

- [ ] **Step 1: 建分支**

```bash
git checkout -b feat/theme-toggle
```

- [ ] **Step 2: 写失败测试**

新建 `test/theme.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { nextTheme } from "../frontend/src/lib/theme";

describe("nextTheme 三态循环", () => {
  it("浅色 → 深色", () => {
    expect(nextTheme("light")).toBe("dark");
  });

  it("深色 → 跟随系统", () => {
    expect(nextTheme("dark")).toBe("system");
  });

  it("跟随系统 → 浅色", () => {
    expect(nextTheme("system")).toBe("light");
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
bun run test
```

预期：`test/theme.test.ts` FAIL（模块不存在），其余 55 条不变。

- [ ] **Step 4: 实现**

新建 `frontend/src/lib/theme.ts`：

```ts
export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "worker_paster_theme";
const CHOICES: ThemeChoice[] = ["light", "dark", "system"];

// 三态循环：浅色 → 深色 → 跟随系统 → 浅色
export function nextTheme(current: ThemeChoice): ThemeChoice {
  const i = CHOICES.indexOf(current);
  return CHOICES[(i + 1) % CHOICES.length];
}

// localStorage 与 document 均为浏览器 API，workerd 单测环境不可用，
// 因此本文件只测 nextTheme 纯函数，其余走手动验收
export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 隐私模式/配额受限：不持久化，本次会话仍生效
  }
}

export function applyTheme(theme: ThemeChoice): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
```

- [ ] **Step 5: 运行确认全绿 + 提交**

```bash
bun run test        # 58/58（55 + 3）
bun --cwd=frontend run check
git add frontend/src/lib/theme.ts test/theme.test.ts
git commit -m "feat: theme choice lib (light/dark/system cycle)"
```

---

### Task 2: CSS 三选择器重组

**Files:**
- Modify: `frontend/src/style.css`（仅文件头部 `:root` 与深色媒体查询块）

- [ ] **Step 1: 替换变量块**

把文件开头的

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
```

整体替换为

```css
:root {
  color-scheme: light;
  --bg: #fafafa;
  --fg: #1a1a1a;
  --muted: #6b7280;
  --card: #ffffff;
  --border: #e5e7eb;
  --accent: #2563eb;
}

/* 深色变量在本块与下方媒体查询中各一份，修改需同步两处 */
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #111827;
  --fg: #f3f4f6;
  --muted: #9ca3af;
  --card: #1f2937;
  --border: #374151;
  --accent: #60a5fa;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #111827;
    --fg: #f3f4f6;
    --muted: #9ca3af;
    --card: #1f2937;
    --border: #374151;
    --accent: #60a5fa;
  }
}
```

语义：未设 `data-theme`（跟随系统）时与现状一致；`data-theme="dark"` 强制深色；`data-theme="light"` 在系统深色下也保持浅色。

- [ ] **Step 2: 构建验证 + 提交**

```bash
bun --cwd=frontend run check
bun run build
git add frontend/src/style.css
git commit -m "feat: data-theme CSS selectors for manual light/dark override"
```

---

### Task 3: ThemeToggle 组件 + 页面接入 + 防闪烁

**Files:**
- Create: `frontend/src/components/ThemeToggle.vue`
- Modify: `frontend/src/views/CreateView.vue`、`frontend/src/views/ViewView.vue`、`frontend/src/main.ts`、`frontend/index.html`、`frontend/src/style.css`

- [ ] **Step 1: 创建组件**

新建 `frontend/src/components/ThemeToggle.vue`：

```vue
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { applyTheme, loadTheme, nextTheme, saveTheme, type ThemeChoice } from "../lib/theme";

const theme = ref<ThemeChoice>("system");

const LABEL: Record<ThemeChoice, string> = {
  light: "☀️ 浅色",
  dark: "🌙 深色",
  system: "🌓 跟随系统",
};

onMounted(() => {
  theme.value = loadTheme();
});

function cycle(): void {
  theme.value = nextTheme(theme.value);
  saveTheme(theme.value);
  applyTheme(theme.value);
}
</script>

<template>
  <button class="theme-toggle" aria-label="切换主题" @click="cycle">{{ LABEL[theme] }}</button>
</template>
```

- [ ] **Step 2: CreateView 接入**

`CreateView.vue`：

① script 追加 import：

```ts
import ThemeToggle from "../components/ThemeToggle.vue";
```

② 模板把

```html
    <h1>worker_paster</h1>
```

替换为

```html
    <div class="page-head">
      <h1>worker_paster</h1>
      <ThemeToggle />
    </div>
```

- [ ] **Step 3: ViewView 接入**

`ViewView.vue`：

① script 追加 import（与现有 import 并列）：

```ts
import ThemeToggle from "../components/ThemeToggle.vue";
```

② 模板 `state === 'ready'` 的操作行（`.row`）末尾、下载按钮之后追加：

```html
        <ThemeToggle />
```

- [ ] **Step 4: main.ts 挂载前应用**

`main.ts` 整体改为：

```ts
import { createApp } from "vue";
import App from "./App.vue";
import "highlight.js/styles/github-dark.css";
import { router } from "./router";
import { applyTheme, loadTheme } from "./lib/theme";
import "./style.css";

applyTheme(loadTheme());

createApp(App).use(router).mount("#app");
```

- [ ] **Step 5: index.html 防闪烁脚本**

`<head>` 内、`<title>` 之后追加：

```html
    <script>
      // 挂载前设置主题，避免强制浅色/深色的用户首屏闪烁
      try {
        var t = localStorage.getItem("worker_paster_theme");
        if (t === "light" || t === "dark") {
          document.documentElement.setAttribute("data-theme", t);
        }
      } catch (e) {}
    </script>
```

- [ ] **Step 6: style.css 追加布局样式**

文件末尾追加：

```css
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-head h1 {
  margin: 0;
}

.theme-toggle {
  white-space: nowrap;
}
```

- [ ] **Step 7: 验证 + 提交**

```bash
bun --cwd=frontend run check
bun run build
bun run test        # 58/58
git add frontend/src/components/ThemeToggle.vue frontend/src/views/CreateView.vue frontend/src/views/ViewView.vue frontend/src/main.ts frontend/index.html frontend/src/style.css
git commit -m "feat: three-state theme toggle on both pages, no-flash init"
```

---

### Task 4: README + 全量回归

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 功能清单**

在 `- **二维码与下载**` 行之后、`- **简约**` 行之前插入：

```markdown
- **三态主题**：浅色 / 深色 / 跟随系统，选择保存在浏览器本地
```

- [ ] **Step 2: 全量回归**

```bash
bun run test                  # 58/58
bun run check
bun --cwd=frontend run check
bun run build
```

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: mention three-state theme in README"
```

浏览器手动验收由主会话执行：三档循环与按钮文案、刷新持久、跟随系统档、强制深色首屏无闪烁、两页一致、代码区恒深色。
