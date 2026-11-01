import { decryptText, encryptText, encryptWithKey, keyCheck } from "../frontend/src/lib/crypto";
import { describe, expect, it } from "vitest";

describe("crypto", () => {
  it("加密后可解密还原（含中文与换行）", async () => {
    const text = "你好，worker_paster！const x = 1;\nline2\n".repeat(10);
    const { ct, iv, keyFragment } = await encryptText(text);
    const plain = await decryptText(ct, iv, keyFragment);
    expect(plain).toBe(text);
  });

  it("空字符串可加解密", async () => {
    const { ct, iv, keyFragment } = await encryptText("");
    expect(await decryptText(ct, iv, keyFragment)).toBe("");
  });

  it("错误密钥解密失败", async () => {
    const a = await encryptText("secret");
    const b = await encryptText("other");
    await expect(decryptText(a.ct, a.iv, b.keyFragment)).rejects.toThrow();
  });

  it("密文被篡改时解密失败", async () => {
    const { ct, iv, keyFragment } = await encryptText("secret");
    const tampered = ct.slice(0, -4) + "AAAA";
    await expect(decryptText(tampered, iv, keyFragment)).rejects.toThrow();
  });

  it("keyFragment 为 43 字符 base64url", async () => {
    const { keyFragment } = await encryptText("x");
    expect(keyFragment).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("1MB 级文本走分块路径仍可往返", async () => {
    const text = ("const x = 1; 你好\n" + "a".repeat(1024)).repeat(900); // ≈ 0.95MB
    const { ct, iv, keyFragment } = await encryptText(text);
    expect(await decryptText(ct, iv, keyFragment)).toBe(text);
  });

  it("emoji（4 字节 UTF-8）可往返", async () => {
    const text = "😀🀄 mixed emoji 中文 ascii";
    const { ct, iv, keyFragment } = await encryptText(text);
    expect(await decryptText(ct, iv, keyFragment)).toBe(text);
  });
});

describe("encryptWithKey / keyCheck（在线编辑）", () => {
  const KEY = "VOPkPSeNqsKFXUbeMkljMZRaEt0TMG_ig4EVBWlnyhQ"; // 43 位 base64url = 32 字节

  it("encryptWithKey 用原密钥加密后可解密还原", async () => {
    const { ct, iv } = await encryptWithKey("编辑后的内容\nline2", KEY);
    await expect(decryptText(ct, iv, KEY)).resolves.toBe("编辑后的内容\nline2");
  });

  it("keyCheck 稳定：同一密钥两次结果一致", async () => {
    expect(await keyCheck(KEY)).toBe(await keyCheck(KEY));
  });

  it("keyCheck 为 22 字符 base64url，且不同密钥结果不同", async () => {
    const kc = await keyCheck(KEY);
    expect(kc).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await keyCheck(KEY.slice(0, 42) + "A")).not.toBe(kc);
  });

  it("encryptText 生成的密钥同样通过 keyCheck 校验", async () => {
    const { ct, iv, keyFragment } = await encryptText("x");
    await expect(decryptText(ct, iv, keyFragment)).resolves.toBe("x");
    expect(await keyCheck(keyFragment)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
