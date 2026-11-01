import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import { MAX_HIGHLIGHT_CHARS, escapeHtml } from "./highlight";

// 代码围栏常见缩写 → highlight.ts 已注册的 hljs 语言
const FENCE_ALIAS: Record<string, string> = {
  js: "javascript",
  py: "python",
};

const md = new MarkdownIt({
  html: false, // 原始 HTML 一律转义，防 XSS
  linkify: true,
  highlight(code, lang) {
    const mapped = FENCE_ALIAS[lang] ?? lang;
    if (code.length <= MAX_HIGHLIGHT_CHARS) {
      try {
        return hljs.highlight(code, { language: mapped }).value;
      } catch {
        // 未注册语言：转义显示
      }
    }
    return escapeHtml(code);
  },
});

// 超过阈值返回空串，调用方退回纯文本代码视图（与高亮阈值同一防线）
export function renderMarkdown(source: string): string {
  if (source.length > MAX_HIGHLIGHT_CHARS) return "";
  return md.render(source);
}
