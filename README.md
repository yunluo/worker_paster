# worker_paster

部署在 Cloudflare Workers 上的零知识云粘贴板：把文本/代码变成一个可分享的链接。

- **零知识**：内容在浏览器端 AES-256-GCM 加密，密钥只在链接 `#` 后的 fragment 里，服务器只存密文
- **自动过期**：1 小时 / 1 天 / 7 天 / 30 天 / 永久，KV TTL 到期自动删除
- **代码高亮**：JavaScript / Python / Vue / HTML / CSS / JSON / INI / YAML / TOML / 纯文本
- **Markdown 渲染**：语言选 Markdown 时渲染为 HTML 展示（原始 HTML 一律转义）
- **自定义 ID**：创建时可自选链接路径（如 `/my-config`），重复自动提示
- **二维码与下载**：创建后扫码即开；查看页一键下载为对应扩展名的文件
- **简约**：无账号、无管理面板；创建过的链接保存在浏览器本地

## 环境要求

- [bun](https://bun.sh) ≥ 1.2（包管理器与脚本入口；1.2 起才有文本格式 `bun.lock`）
- Node.js ≥ 20（vitest / wrangler 运行时）
- 一个 Cloudflare 账号（部署时需要 `wrangler login`）

## 本地开发

```bash
# 1. 安装依赖（workspaces 一次装好根与 frontend）
bun install

# 2. 构建前端（wrangler dev 与测试都需要 frontend/dist 存在）
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
- 二维码在浏览器本地生成，链接（含密钥）不经过任何第三方服务
