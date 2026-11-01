import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../frontend/src/lib/markdown";

describe("renderMarkdown", () => {
  it("渲染标题/列表/加粗", () => {
    const html = renderMarkdown("# 标题\n\n- 项目一\n- 项目二\n\n**加粗**");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain("<strong>加粗</strong>");
  });

  it("渲染表格", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("原始 HTML 被转义（html:false 防 XSS）", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">d</div>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<div");
    expect(html).toContain("&lt;script&gt;");
  });

  it("链接渲染并带 href", () => {
    const html = renderMarkdown("[示例](https://example.com)");
    expect(html).toContain('<a href="https://example.com">示例</a>');
  });

  it("javascript: 链接目标不产生 href", () => {
    const html = renderMarkdown("[a](javascript:alert(1))");
    expect(html).not.toContain('href="javascript');
    expect(renderMarkdown("javascript:alert(1)")).not.toContain("<a ");
  });

  it("围栏代码按语言高亮（含 js 别名）", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("hljs-");
  });

  it("未注册围栏语言转义显示", () => {
    const html = renderMarkdown("```\n<b>&raw</b>\n```");
    expect(html).toContain("&lt;b&gt;");
  });

  it("超过 256KB 返回空串（调用方退回纯文本视图）", () => {
    const big = "# t\n" + "段".repeat(256 * 1024);
    expect(renderMarkdown(big)).toBe("");
  });
});
