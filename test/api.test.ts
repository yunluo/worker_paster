import type { Env } from "../src/index";
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

const VALID_BODY = {
  ct: "AAECAwQFBgcICQ==", // 10 字节 base64
  iv: "AAECAwQFBgcICQoL", // 12 字节 base64（计划原稿 "AAECAwQFBgcI" 实为 9 字节，此处修正为真实 12 字节 IV）
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

  it("expiry 传 Object.prototype 属性名返回 400", async () => {
    const res = await post({ ...VALID_BODY, expiry: "toString" });
    expect(res.status).toBe(400);
  });

  it("请求体为 JSON null 返回 400", async () => {
    const res = await post("null");
    expect(res.status).toBe(400);
  });
});

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
