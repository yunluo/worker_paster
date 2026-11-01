<script setup lang="ts">
import { computed, ref } from "vue";
import { encryptText } from "../lib/crypto";
import { addHistory, clearHistory, loadHistory, removeHistory, type PasteRecord } from "../lib/history";
import { langLabel } from "../lib/highlight";

const LANG_OPTIONS = [
  { value: "plaintext", label: "纯文本" },
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "vue", label: "Vue" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "ini", label: "INI" },
  { value: "yaml", label: "YAML" },
  { value: "toml", label: "TOML" },
];

const EXPIRY_OPTIONS = [
  { value: "1h", label: "1 小时" },
  { value: "1d", label: "1 天" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "never", label: "永久" },
];

const EXPIRY_SECONDS: Record<string, number | null> = {
  "1h": 3600,
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  never: null,
};

const MAX_TEXT_BYTES = 1024 * 1024;

const text = ref("");
const lang = ref("plaintext");
const expiry = ref("7d");
const creating = ref(false);
const error = ref("");
const shareLink = ref("");
const history = ref<PasteRecord[]>(loadHistory());
const showHistory = ref(false);

const textBytes = computed(() => new TextEncoder().encode(text.value).length);

function expiresAtOf(expiry: string): number | null {
  const ttl = EXPIRY_SECONDS[expiry];
  return ttl === null || ttl === undefined ? null : Date.now() + ttl * 1000;
}

async function create(): Promise<void> {
  error.value = "";
  shareLink.value = "";
  if (!text.value) {
    error.value = "内容不能为空";
    return;
  }
  if (textBytes.value > MAX_TEXT_BYTES) {
    error.value = "内容超过 1MB 上限";
    return;
  }
  creating.value = true;
  try {
    const { ct, iv, keyFragment } = await encryptText(text.value);
    const res = await fetch("/api/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ct, iv, lang: lang.value, expiry: expiry.value }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `创建失败（${res.status}）`);
    }
    const { id } = (await res.json()) as { id: string };
    shareLink.value = `${location.origin}/${id}#${keyFragment}`;
    addHistory({
      id,
      key: keyFragment,
      lang: lang.value,
      created_at: Date.now(),
      expires_at: expiresAtOf(expiry.value),
    });
    history.value = loadHistory();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    creating.value = false;
  }
}

async function copyShareLink(): Promise<void> {
  await navigator.clipboard.writeText(shareLink.value);
}

function fullLink(rec: PasteRecord): string {
  return `${location.origin}/${rec.id}#${rec.key}`;
}

function fmtTime(ts: number | null): string {
  return ts === null ? "永久" : new Date(ts).toLocaleString();
}

function removeOne(id: string): void {
  removeHistory(id);
  history.value = loadHistory();
}

function clearAll(): void {
  clearHistory();
  history.value = loadHistory();
}
</script>

<template>
  <div class="container">
    <h1>worker_paster</h1>
    <p class="muted">零知识云粘贴板：内容在本地加密，服务器只存密文。</p>

    <textarea v-model="text" placeholder="粘贴要分享的文本或代码…"></textarea>

    <div class="row">
      <select v-model="lang" aria-label="语言类型">
        <option v-for="o in LANG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <select v-model="expiry" aria-label="过期时间">
        <option v-for="o in EXPIRY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <button class="primary" :disabled="creating" @click="create">
        {{ creating ? "创建中…" : "创建链接" }}
      </button>
      <span class="muted">{{ textBytes }} / 1048576 字节</span>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="shareLink" class="link-box">
      <div>{{ shareLink }}</div>
      <div class="row">
        <button @click="copyShareLink">复制链接</button>
        <span class="muted">密钥在 # 后面，服务器看不到；链接丢失无法找回。</span>
      </div>
    </div>

    <div v-if="history.length" class="history">
      <div class="row">
        <button @click="showHistory = !showHistory">我的记录（{{ history.length }}）</button>
        <button v-if="showHistory" @click="clearAll">清空</button>
      </div>
      <template v-if="showHistory">
        <ul>
          <li v-for="rec in history" :key="rec.id">
            <a :href="fullLink(rec)">{{ fullLink(rec) }}</a>
            <span class="muted"> — {{ langLabel(rec.lang) }} · 过期：{{ fmtTime(rec.expires_at) }}</span>
            <button @click="removeOne(rec.id)">删除</button>
          </li>
        </ul>
        <p class="muted">记录仅保存在本浏览器。</p>
      </template>
    </div>
  </div>
</template>
