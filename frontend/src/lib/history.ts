export interface PasteRecord {
  id: string;
  /** URL fragment 中的密钥（base64url） */
  key: string;
  lang: string;
  created_at: number;
  expires_at: number | null;
}

const STORAGE_KEY = "worker_paster_history";
const MAX_RECORDS = 100;

export function loadHistory(): PasteRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is PasteRecord =>
        typeof v === "object" && v !== null && typeof (v as PasteRecord).id === "string",
    );
  } catch {
    return [];
  }
}

export function addHistory(rec: PasteRecord): void {
  const list = loadHistory().filter((r) => r.id !== rec.id);
  list.unshift(rec);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    // 存储满/隐私模式：忽略，历史功能非关键
  }
}

export function removeHistory(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadHistory().filter((r) => r.id !== id)));
  } catch {
    // 同上
  }
}

// 就地更新一条历史（如在线编辑后语言变化），记录不存在时静默跳过
export function patchHistory(id: string, patch: Partial<Omit<PasteRecord, "id" | "key">>): void {
  const list = loadHistory();
  const rec = list.find((r) => r.id === id);
  if (!rec) return;
  Object.assign(rec, patch);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 同上
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}
