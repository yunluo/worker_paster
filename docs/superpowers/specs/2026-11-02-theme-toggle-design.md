# worker_paster 夜间模式（三态主题切换）设计

- 日期：2026-11-02
- 状态：已确认（待实现）
- 基线：现有主题为纯系统跟随（`prefers-color-scheme`），本设计叠加手动三态切换

## 1. 目标

在两个页面提供主题切换：**浅色 → 深色 → 跟随系统** 循环，选择存 localStorage，刷新持久、切换即时生效、首屏不闪。

## 2. 状态与持久化

- `type ThemeChoice = "light" | "dark" | "system"`，默认 `"system"`
- 新增 `frontend/src/lib/theme.ts`：
  - `loadTheme(): ThemeChoice` — 读 localStorage 键 `worker_paster_theme`，try/catch（与 history.ts 同款防御），非法值/缺失回退 `system`
  - `saveTheme(t: ThemeChoice): void` — try/catch 写入
  - `nextTheme(t): ThemeChoice` — `light → dark → system → light`
  - `applyTheme(t): void` — `system` 时移除 `<html>` 的 `data-theme`，否则设为 `light`/`dark`
- `main.ts` 在 `createApp` 前调用 `applyTheme(loadTheme())`

## 3. CSS（style.css 改造）

```css
:root { …现有浅色变量…; color-scheme: light; }
:root[data-theme="dark"] { …深色变量…; color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { …深色变量…; color-scheme: dark; }
}
```

- 未设 `data-theme` 时行为与现状完全一致（系统跟随）
- 深色变量块需写两份（纯 CSS 无共享机制），加注释"修改深色变量需同步两处"
- 代码区 `.code-wrap` / `.markdown-body pre` **维持恒深色**设计，不随主题变化

## 4. UI

- 新增 `frontend/src/components/ThemeToggle.vue`：单个按钮循环三态，按钮文本显示当前模式——`☀️ 浅色` / `🌙 深色` / `🌓 跟随系统`；点击 `nextTheme → saveTheme → applyTheme` 并更新自身状态；`aria-label="切换主题"`
- 放置：创建页标题行右侧（与 h1 同行，`margin-left: auto`）；查看页顶部操作行
- 点击即时生效，无需刷新

## 5. 防闪烁

`frontend/index.html` `<head>` 加内联脚本（try/catch）：DOM 解析阶段即读 localStorage 设置 `data-theme`，强制浅色/深色的用户首屏不闪。

## 6. 测试

- 单测 `test/theme.test.ts`：`nextTheme` 循环顺序全覆盖 + 默认值语义。`loadTheme/saveTheme`（localStorage）与 `applyTheme`（document）是薄函数，workerd 无对应 API，不进单测，走手动验收
- 手动验收：
  1. 三档点击循环、按钮文本随之变化、两页一致
  2. 强制深色/浅色后刷新仍保持（localStorage 持久）
  3. `跟随系统` 档随系统偏好变化；未选择时行为与现状一致
  4. 首屏无闪烁（强制深色下刷新从第一帧即深色）
  5. 代码区（高亮块/Markdown 代码块）在浅色主题下仍为深色背景

## 7. 非目标

- 不做多主题/主题色选择器，不做服务端同步，不引入 UI 组件库
