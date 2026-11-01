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
  let id = "";
  while (id.length < ID_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
    for (const b of bytes) {
      if (b >= 248) continue; // 62 * 4 = 248，拒绝采样消除取模偏差
      id += ID_ALPHABET[b % ID_ALPHABET.length];
      if (id.length === ID_LENGTH) break;
    }
  }
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
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "请求体不是合法 JSON" }, 400);
      }
      if (typeof body !== "object" || body === null) {
        return json({ error: "请求体不是合法 JSON" }, 400);
      }

      const { ct, iv, lang, expiry } = body as Record<string, unknown>;
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
      if (!Object.hasOwn(EXPIRY_SECONDS, expiry)) {
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

    const getMatch = url.pathname.match(/^\/api\/get\/([0-9A-Za-z]{8})$/);
    if (getMatch && request.method === "GET") {
      const raw = await env.PASTES.get(getMatch[1]);
      if (raw === null) return json({ error: "粘贴不存在或已过期" }, 404);
      return new Response(raw, {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
