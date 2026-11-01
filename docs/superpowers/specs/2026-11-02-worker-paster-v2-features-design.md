# worker_paster 增量功能设计（v2）：Markdown 渲染、二维码、自定义 ID、下载

- 日期：2026-11-02
- 状态：已确认（设计已用户确认，待实现）
- 基线：[2026-11-01-worker-paster-design.md](2026-11-01-worker-paster-design.md)（本文只描述增量，其余维持基线设计）

## 1. 背景与目标

对已上线的零知识粘贴板追加 4 个同类项目（PrivateBin、MicroBin、CloudPaste 等）普遍具备、且与"零知识 + 简约"定位兼容的功能：

1. **Markdown 渲染**：粘贴 Markdown 时渲染为 HTML 展示
2. **二维码**：创建成功后可扫码打开链接（手机间传递）
3. **自定义 ID**：可自选链接路径（如 `/my-nginx-conf`），便于永久配置直链
4. **下载为文件**：查看页一键把原文存为带扩展名的文件

设计决策（用户确认）：

- 自定义 ID **即唯一 ID**（不做"随机 ID + 别名"双链接）
- Markdown 作为语言下拉里的一个选项（复用 `lang` 字段，数据模型零改动）
- 二维码仅出现在**创建页**成功区（查看页保持极简）

## 2. 非目标

- 不做 Markdown 源/预览双栏切换、编辑器工具栏、导出 PDF/HTML
- 不做随机 ID + 别名双链接机制
- 不做查看页二维码、阅后即焚、二次密码（后续候选）
- 其余沿用基线非目标（无账号、无文件上传、无管理面板）

## 3. 自定义 ID

### API（src/index.ts）

- `POST /api/new` 请求体新增**可选**字段 `id`
- 校验（顺序）：字符集与长度 `/^[A-Za-z0-9_-]{3,32}$/` → 非法返回 `400 { "error": "自定义 ID 只能包含字母、数字、-、_，长度 3–32" }`；保留字 `api`、`assets`（与 Worker 路由 / 静态资源目录冲突）→ `400`
- 唯一性：写入前 `env.PASTES.get(id)` 检查，已占用返回 `409 { "error": "该 ID 已被占用" }`。get→put 之间有极小并发窗口，内部 ≤10 人使用可接受（文档注明）
- 未提供 `id`：走现有 8 位 base62 随机逻辑，行为不变
- `GET /api/get/:id` 路由正则从 `[0-9A-Za-z]{8}` 放宽为 `[A-Za-z0-9_-]{3,32}`（随机 8 位是其子集，老链接兼容）
  - 行为变化：原先"9 位纯字母数字"走通用兜底 404，现在会命中 API 路由返回 `404 "粘贴不存在或已过期"`；现有相关测试随之更新

### 创建页（CreateView.vue）

- 可选「自定义 ID」输入框，placeholder 展示规则；前端在**提交时**校验同样正则与保留字，非法时在现有错误展示位报错，不发请求
- 收到 `409` 时展示"该 ID 已被占用"，**保留已输入内容**，改 ID 后可直接重试
- 历史记录照常写入实际使用的 ID

### 安全说明

- 自定义 ID 可枚举（比随机 ID 好猜），但零知识模型下枚举者只能拿到密文 + 语言 + 时间，没有 fragment 密钥无法解密，风险可接受
- 二维码与历史记录均包含完整链接（含密钥），与现状一致

## 4. Markdown 渲染

- 渲染器：**markdown-it**，配置 `{ html: false }`——原始 HTML 一律转义（粘贴 `<script>` 显示字面量），从根上防 XSS；GFM 表格、删除线、代码围栏开箱即用
- `lang === "markdown"` 时：
  - Worker `LANGS` 白名单新增 `"markdown"`（10 → 11）
  - 查看页用 markdown-it 渲染后 `v-html`，套手写 `.markdown-body` 样式（标题/列表/表格/代码块/引用，深浅色跟随现有 CSS 变量，不引外部 markdown CSS 主题）
  - 代码围栏复用现有 hljs 注册的 7 种语言高亮，未注册语言转义显示
  - 超过 `MAX_HIGHLIGHT_CHARS`（256KB）不渲染，退化为纯文本转义显示（与现有高亮阈值同一防线）
  - 复制按钮行为不变（复制的本就是解密后的源文）
- 其余语言行为完全不变；`LANG_MAP` 中 `markdown` 项不注册 hljs 语法（走渲染路径，非高亮路径）

## 5. 二维码

- 依赖：`qrcode` npm 包（前端 devDependencies 之外的 dependencies）
- **纯前端本地生成**：`QRCode.toDataURL(shareLink)` → `<img>`。硬约束：绝不调用外部二维码 API——链接 fragment 含密钥，经过第三方即泄露
- 位置：创建页成功区，链接与复制按钮旁，约 160px 见方，`alt="分享链接二维码"`
- 链接变化（重新创建）时重新生成

## 6. 下载为文件

- 查看页新增「下载」按钮：`Blob([原文])` + `a[download]`，文件名 `<id><扩展名>`
- 扩展名映射：`javascript→.js`、`python→.py`、`vue→.vue`、`css→.css`、`html→.html`、`json→.json`、`ini→.ini`、`yaml→.yml`、`toml→.toml`、`markdown→.md`、`plaintext→.txt`
- 下载内容始终是解密后的源文（Markdown 下载源文而非渲染 HTML）

## 7. 依赖与结构变化

```
frontend/package.json   新增 dependencies: markdown-it、qrcode（含各自的 @types）
frontend/src/lib/
  ├── markdown.ts       新增：markdown-it 实例（html:false + hljs 高亮围栏）、renderMarkdown()
  └── download.ts       新增：扩展名映射、downloadText(id, lang, text)
frontend/src/views/
  ├── CreateView.vue    自定义 ID 输入 + 校验；二维码展示
  └── ViewView.vue      markdown 渲染分支；下载按钮
frontend/src/style.css  .markdown-body 样式（跟随现有深浅色变量）
src/index.ts            自定义 ID 校验/冲突/保留字；LANGS + markdown；GET 正则放宽
test/api.test.ts        新用例（见 §8）；更新 9 位 ID 行为变化的用例
test/markdown.test.ts   新增
```

- KV value 结构不变，**无数据迁移**；已部署实例可直接滚动升级
- 新依赖体积：markdown-it + qrcode 约 50KB gzip 级别，对内部工具可接受

## 8. 测试

- API（vitest-pool-workers）：
  1. 带 `id` 创建成功，`GET /api/get/<id>` 可读回
  2. 非法字符（含中文/空格/`.`）、过短（2 位）、过长（33 位）→ 400
  3. 保留字 `api` / `assets` → 400
  4. 冲突（同 ID 二次创建）→ 409
  5. `lang: "markdown"` 创建成功；随机 ID 未传时行为与之前一致
  6. 更新：9 位 ID 现在命中 API 404（`粘贴不存在或已过期`）
- 前端库（vitest）：markdown-it 标题/列表/表格渲染、**原始 HTML 被转义**、围栏代码高亮；扩展名映射全覆盖
- 手动验收：
  1. Markdown 粘贴渲染正确（标题/表格/代码块/链接），`<script>` 字面量显示
  2. 创建后二维码可扫开且内容 = 完整链接（含 fragment）
  3. 自定义 ID `my-test-01` 创建 → `/my-test-01#key` 可读；重复创建同 ID → 409 提示
  4. 各语言下载文件内容与原文一致、扩展名正确
  5. 老随机链接回归不受影响

## 9. 部署

与基线一致（`bun run deploy`），无新增配置项、无迁移步骤。
