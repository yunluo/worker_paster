import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// 依赖 frontend/dist 已构建（bun run build）：vitest-pool-workers 读取
// wrangler.toml 的 [assets] 配置时需要该目录存在
describe("静态资源与 SPA fallback", () => {
  it("GET / 返回 SPA HTML", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="app"></div>');
  });

  it("GET /:id 走 SPA fallback", async () => {
    const res = await SELF.fetch("https://example.com/abcd1234");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app"></div>');
  });

  it("/api/* 强制走 Worker（JSON 404）", async () => {
    const res = await SELF.fetch("https://example.com/api/get/short");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
