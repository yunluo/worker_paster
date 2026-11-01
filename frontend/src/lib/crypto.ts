// AES-256-GCM 加解密封装：密文与 IV 以标准 base64 存服务端，
// 密钥以 base64url 形式只出现在 URL fragment 中。
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptResult {
  /** base64 密文（提交给服务端） */
  ct: string;
  /** base64 IV（提交给服务端） */
  iv: string;
  /** base64url 原始密钥（放进 URL fragment，不发给服务端） */
  keyFragment: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return base64ToBytes(b64);
}

export async function encryptText(plaintext: string): Promise<EncryptResult> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyFragment = toBase64Url(rawKey);
  const { ct, iv } = await encryptWithKey(plaintext, keyFragment);
  return { ct, iv, keyFragment };
}

// 用已有密钥加密（编辑场景：链接与密钥保持不变）
export async function encryptWithKey(
  plaintext: string,
  keyFragment: string,
): Promise<{ ct: string; iv: string }> {
  const rawKey = fromBase64Url(keyFragment);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ct: bytesToBase64(new Uint8Array(ctBuf)), iv: bytesToBase64(iv) };
}

// 密钥校验值：SHA-256 前 16 字节 base64url。服务端存它以验证编辑者持钥，
// 但无法由它反推密钥——"谁能读谁就能改"且不向服务器暴露密钥本体
export async function keyCheck(keyFragment: string): Promise<string> {
  const rawKey = fromBase64Url(keyFragment);
  const digest = await crypto.subtle.digest("SHA-256", rawKey);
  return toBase64Url(new Uint8Array(digest).slice(0, 16));
}

export async function decryptText(ct: string, iv: string, keyFragment: string): Promise<string> {
  const rawKey = fromBase64Url(keyFragment);
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ct),
  );
  return decoder.decode(plainBuf);
}
