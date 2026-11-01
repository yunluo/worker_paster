const EXT_MAP: Record<string, string> = {
  javascript: "js",
  python: "py",
  vue: "vue",
  css: "css",
  html: "html",
  json: "json",
  ini: "ini",
  yaml: "yml",
  toml: "toml",
  markdown: "md",
  plaintext: "txt",
};

export function extFor(lang: string): string {
  return EXT_MAP[lang] ?? "txt";
}

export function fileNameFor(id: string, lang: string): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_") || "paste";
  return `${safeId}.${extFor(lang)}`;
}

// 浏览器端下载解密后的源文；仅在被视图层调用时执行（无单测，走手动验收）
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
