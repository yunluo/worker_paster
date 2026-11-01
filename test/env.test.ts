import type { Env } from "../src/index";
import { env } from "cloudflare:test";
import { expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

it("KV 绑定 PASTES 可用", async () => {
  await env.PASTES.put("smoke", "ok");
  expect(await env.PASTES.get("smoke")).toBe("ok");
  await env.PASTES.delete("smoke");
});
