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

  it("自定义 ID 允许下划线", async () => {
    const res = await post({ ...VALID_BODY, id: "a_b" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toBe("a_b");
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

  it("lang markdown 创建成功", async () => {
    const res = await post({ ...VALID_BODY, lang: "markdown" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    const record = JSON.parse((await env.PASTES.get(id))!) as Record<string, unknown>;
    expect(record.lang).toBe("markdown");
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

  it("GET 返回 editable 标记且绝不泄露 kc", async () => {
    await env.PASTES.put(
      "editab01",
      JSON.stringify({
        v: 1,
        ct: "x",
        iv: "y",
        lang: "json",
        created_at: 1,
        expires_at: null,
        kc: "super-secret-kc",
      }),
    );
    const res = await SELF.fetch("https://example.com/api/get/editab01");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("super-secret-kc");
    const record = JSON.parse(text) as Record<string, unknown>;
    expect(record.editable).toBe(true);
  });

  it("GET 旧记录（无 kc）editable 为 false", async () => {
    await env.PASTES.put(
      "oldrec01",
      JSON.stringify({ v: 1, ct: "x", iv: "y", lang: "json", created_at: 1, expires_at: null }),
    );
    const res = await SELF.fetch("https://example.com/api/get/oldrec01");
    const record = (await res.json()) as Record<string, unknown>;
    expect(record.editable).toBe(false);
  });
});

describe("PUT /api/update/:id", () => {
  afterEach(cleanKv);

  const KC = "test-kc-value-0000000000000000";

  async function seed(kc: string | null, expiresAt: number | null = null): Promise<void> {
    const record: Record<string, unknown> = {
      v: 1,
      ct: "old-ct",
      iv: "AAECAwQFBgcICQoL",
      lang: "json",
      created_at: 1,
      expires_at: expiresAt,
    };
    if (kc) record.kc = kc;
    await env.PASTES.put("upd0001", JSON.stringify(record));
  }

  function put(body: unknown): Promise<Response> {
    return SELF.fetch("https://example.com/api/update/upd0001", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  it("kc 匹配：更新 ct/iv/lang 并写 updated_at，created_at/kc 不变", async () => {
    await seed(KC);
    const res = await put({
      ct: "AAECAwQFBgcICQ==",
      iv: "AAECAwQFBgcICQoL",
      lang: "markdown",
      kc: KC,
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse((await env.PASTES.get("upd0001"))!) as Record<string, unknown>;
    expect(stored.ct).toBe("AAECAwQFBgcICQ==");
    expect(stored.lang).toBe("markdown");
    expect(stored.created_at).toBe(1);
    expect(stored.kc).toBe(KC);
    expect(stored.updated_at).toBeGreaterThan(0);
  });

  it("永久粘贴编辑后仍无过期时间", async () => {
    await seed(KC, null);
    const res = await put({ ct: "new", iv: "AAECAwQFBgcICQoL", lang: "json", kc: KC });
    expect(res.status).toBe(200);
    const stored = JSON.parse((await env.PASTES.get("upd0001"))!) as Record<string, unknown>;
    expect(stored.expires_at).toBeNull();
  });

  it("TTL 粘贴编辑后原过期时间保持", async () => {
    const expiresAt = Date.now() + 10 * 60_000;
    await seed(KC, expiresAt);
    const res = await put({ ct: "new", iv: "AAECAwQFBgcICQoL", lang: "json", kc: KC });
    expect(res.status).toBe(200);
    const stored = JSON.parse((await env.PASTES.get("upd0001"))!) as Record<string, unknown>;
    expect(stored.expires_at).toBe(expiresAt);
  });

  it("TTL 剩余不足 60 秒返回 400", async () => {
    await seed(KC, Date.now() + 30_000);
    const res = await put({ ct: "new", iv: "AAECAwQFBgcICQoL", lang: "json", kc: KC });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "粘贴即将过期，无法编辑" });
  });

  it("kc 不匹配返回 403 且不修改记录", async () => {
    await seed(KC);
    const res = await put({ ct: "evil", iv: "AAECAwQFBgcICQoL", lang: "json", kc: "wrong-kc" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "密钥校验失败，无权编辑" });
    const stored = JSON.parse((await env.PASTES.get("upd0001"))!) as Record<string, unknown>;
    expect(stored.ct).toBe("old-ct");
  });

  it("旧记录（无 kc）返回 403", async () => {
    await seed(null);
    const res = await put({ ct: "new", iv: "AAECAwQFBgcICQoL", lang: "json", kc: KC });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "旧版本粘贴不支持在线编辑，请重新创建" });
  });

  it("不存在的 ID 返回 404", async () => {
    const res = await put({ ct: "new", iv: "AAECAwQFBgcICQoL", lang: "json", kc: KC });
    expect(res.status).toBe(404);
  });

  it("非法 lang / 非法 IV / 缺字段 / 非 JSON 请求体均返回 400", async () => {
    await seed(KC);
    expect(
      (await put({ ct: "n", iv: "AAECAwQFBgcICQoL", lang: "rust", kc: KC })).status,
    ).toBe(400);
    expect((await put({ ct: "n", iv: "AAAA", lang: "json", kc: KC })).status).toBe(400);
    expect((await put({ ct: "n", lang: "json", kc: KC })).status).toBe(400);
    const bad = await SELF.fetch("https://example.com/api/update/upd0001", {
      method: "PUT",
      body: "not json",
    });
    expect(bad.status).toBe(400);
  });
});
