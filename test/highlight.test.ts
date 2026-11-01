import { highlight, langLabel, MAX_HIGHLIGHT_CHARS } from "../frontend/src/lib/highlight";
import { describe, expect, it } from "vitest";

describe("highlight", () => {
  it("javascript 代码高亮为带 hljs class 的 span", () => {
    const html = highlight("const x = 1;", "javascript");
    expect(html).toContain("hljs");
  });

  it("plaintext 返回转义后的纯文本，无高亮标记", () => {
    const html = highlight("<script>", "plaintext");
    expect(html).toBe("&lt;script&gt;");
    expect(html).not.toContain("hljs");
  });

  it("未知语言回退为转义文本", () => {
    const html = highlight("<b>", "nope");
    expect(html).toBe("&lt;b&gt;");
  });

  it("langLabel 返回显示名", () => {
    expect(langLabel("vue")).toBe("Vue");
    expect(langLabel("plaintext")).toBe("纯文本");
    expect(langLabel("toml")).toBe("TOML");
  });

  it("超过 256K 字符跳过高亮，返回转义文本", () => {
    const html = highlight("a".repeat(256 * 1024 + 1), "javascript");
    expect(html).not.toContain("hljs");
    expect(html).toBe("a".repeat(256 * 1024 + 1));
  });

  it("恰好 256K 字符仍高亮（边界语义：> 才跳过）", () => {
    // 需含关键字才能产生 hljs 标记：纯字母串在 hljs 下不包 span，
    // 与转义路径输出相同，无法区分是否真的走了高亮
    const html = highlight("if (".repeat(MAX_HIGHLIGHT_CHARS / 4), "javascript");
    expect(html).toContain("hljs");
  });

  it("grammar 输出不泄漏原始 <script>/<img 标记", () => {
    const html = highlight("</script><img src=x onerror=alert(1)>", "javascript");
    expect(html).not.toMatch(/<(script|img)\b/i);
  });
});
