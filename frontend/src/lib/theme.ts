export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "worker_paster_theme";
const CHOICES: ThemeChoice[] = ["light", "dark", "system"];

// 三态循环：浅色 → 深色 → 跟随系统 → 浅色
export function nextTheme(current: ThemeChoice): ThemeChoice {
  const i = CHOICES.indexOf(current);
  return CHOICES[(i + 1) % CHOICES.length];
}

// localStorage 与 document 均为浏览器 API，workerd 单测环境不可用，
// 因此本文件只测 nextTheme 纯函数，其余走手动验收
export function loadTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 隐私模式/配额受限：不持久化，本次会话仍生效
  }
}

export function applyTheme(theme: ThemeChoice): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
