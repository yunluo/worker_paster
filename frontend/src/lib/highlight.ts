import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("yaml", yaml);

interface LangDef {
  hljsLang: string;
  label: string;
}

const LANG_MAP: Record<string, LangDef> = {
  javascript: { hljsLang: "javascript", label: "JavaScript" },
  python: { hljsLang: "python", label: "Python" },
  vue: { hljsLang: "xml", label: "Vue" },
  html: { hljsLang: "xml", label: "HTML" },
  css: { hljsLang: "css", label: "CSS" },
  json: { hljsLang: "json", label: "JSON" },
  ini: { hljsLang: "ini", label: "INI" },
  yaml: { hljsLang: "yaml", label: "YAML" },
  toml: { hljsLang: "ini", label: "TOML" },
  plaintext: { hljsLang: "", label: "纯文本" },
};

export function langLabel(lang: string): string {
  return LANG_MAP[lang]?.label ?? lang;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlight(code: string, lang: string): string {
  const hljsLang = LANG_MAP[lang]?.hljsLang;
  if (!hljsLang) return escapeHtml(code);
  try {
    return hljs.highlight(code, { language: hljsLang }).value;
  } catch {
    return escapeHtml(code);
  }
}
