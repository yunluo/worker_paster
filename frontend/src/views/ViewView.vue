<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { decryptText, encryptWithKey, keyCheck } from "../lib/crypto";
import { highlight, langLabel } from "../lib/highlight";
import { renderMarkdown } from "../lib/markdown";
import { downloadText, fileNameFor } from "../lib/download";
import { LANG_OPTIONS } from "../lib/langs";
import { patchHistory } from "../lib/history";
import ThemeToggle from "../components/ThemeToggle.vue";

type State = "loading" | "ready" | "nokey" | "notfound" | "decrypterror" | "network";

const route = useRoute();
const state = ref<State>("loading");
const text = ref("");
const lang = ref("plaintext");
const createdAt = ref<number | null>(null);
const expiresAt = ref<number | null>(null);
const updatedAt = ref<number | null>(null);
const editable = ref(false);
const currentId = ref("");
const currentKey = ref("");

const editing = ref(false);
const editText = ref("");
const editLang = ref("plaintext");
const saving = ref(false);
const editError = ref("");

const lineCount = computed(() => text.value.split("\n").length);
const html = computed(() => highlight(text.value, lang.value));
const isMarkdown = computed(() => lang.value === "markdown");
// renderMarkdown 超过阈值返回 ""，此时回落到下方纯文本代码视图
const mdHtml = computed(() => (isMarkdown.value ? renderMarkdown(text.value) : ""));

onMounted(load);

// 仅 hash 变化（如先打开 /id 后补 #密钥）不会重新挂载组件，侦听路由变化重跑加载
watch(() => route.fullPath, load);

async function load(): Promise<void> {
  state.value = "loading";
  editing.value = false;
  const id = String(route.params.id ?? "");
  const key = route.hash.replace(/^#/, "");
  if (!key) {
    state.value = "nokey";
    return;
  }
  try {
    const res = await fetch(`/api/get/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      state.value = "notfound";
      return;
    }
    if (!res.ok) {
      state.value = "network";
      return;
    }
    const data = (await res.json()) as {
      ct: string;
      iv: string;
      lang: string;
      created_at: number;
      expires_at: number | null;
      updated_at?: number;
      editable: boolean;
    };
    lang.value = data.lang;
    createdAt.value = data.created_at;
    expiresAt.value = data.expires_at;
    updatedAt.value = data.updated_at ?? null;
    editable.value = data.editable === true;
    currentId.value = id;
    currentKey.value = key;
    try {
      text.value = await decryptText(data.ct, data.iv, key);
    } catch {
      state.value = "decrypterror";
      return;
    }
    state.value = "ready";
  } catch {
    state.value = "network";
  }
}

function startEdit(): void {
  editText.value = text.value;
  editLang.value = lang.value;
  editError.value = "";
  editing.value = true;
}

function cancelEdit(): void {
  editing.value = false;
}

async function saveEdit(): Promise<void> {
  if (!editText.value) {
    editError.value = "内容不能为空";
    return;
  }
  saving.value = true;
  editError.value = "";
  try {
    const { ct, iv } = await encryptWithKey(editText.value, currentKey.value);
    const res = await fetch(`/api/update/${encodeURIComponent(currentId.value)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ct, iv, lang: editLang.value, kc: await keyCheck(currentKey.value) }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `保存失败（${res.status}）`);
    }
    text.value = editText.value;
    lang.value = editLang.value;
    updatedAt.value = Date.now();
    patchHistory(currentId.value, { lang: editLang.value });
    editing.value = false;
  } catch (e) {
    editError.value = e instanceof TypeError
      ? "网络错误，请重试"
      : e instanceof Error
        ? e.message
        : "保存失败，请重试";
  } finally {
    saving.value = false;
  }
}

async function copyText(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value);
  } catch {
    // 剪贴板不可用（权限/非安全上下文）：静默失败，用户可手动选择文本
  }
}

function download(): void {
  const id = String(route.params.id ?? "paste");
  downloadText(fileNameFor(id, lang.value), text.value);
}

function fmtTime(ts: number | null): string {
  return ts === null ? "永久" : new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="container">
    <p v-if="state === 'loading'" class="muted">加载中…</p>

    <div v-else-if="state === 'nokey'" class="error">
      链接不完整：缺少 # 后面的密钥，无法解密。
    </div>

    <div v-else-if="state === 'notfound'" class="error">粘贴不存在或已过期。</div>

    <div v-else-if="state === 'decrypterror'" class="error">
      解密失败：链接可能不完整或已损坏。
    </div>

    <div v-else-if="state === 'network'" class="error">
      网络错误。
      <button @click="load">重试</button>
    </div>

    <template v-else-if="state === 'ready'">
      <div class="row">
        <strong>{{ langLabel(lang) }}</strong>
        <span class="muted">
          创建于 {{ fmtTime(createdAt) }} · 过期：{{ fmtTime(expiresAt) }}
          <template v-if="updatedAt !== null"> · 更新于 {{ fmtTime(updatedAt) }}</template>
        </span>
        <button @click="copyText">复制原文</button>
        <button @click="download">下载</button>
        <button v-if="editable && !editing" @click="startEdit">编辑</button>
        <ThemeToggle />
      </div>
      <template v-if="editing">
        <textarea v-model="editText" aria-label="编辑内容"></textarea>
        <div class="row">
          <select v-model="editLang" aria-label="编辑语言类型">
            <option v-for="o in LANG_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <button class="primary" :disabled="saving" @click="saveEdit">
            {{ saving ? "保存中…" : "保存修改" }}
          </button>
          <button :disabled="saving" @click="cancelEdit">取消</button>
        </div>
        <p v-if="editError" class="error">{{ editError }}</p>
      </template>
      <template v-else>
        <div v-if="mdHtml" class="markdown-body" v-html="mdHtml"></div>
        <div v-else class="code-wrap">
          <div class="gutter">
            <span v-for="n in lineCount" :key="n">{{ n }}</span>
          </div>
          <pre class="code"><code v-html="html"></code></pre>
        </div>
      </template>
    </template>
  </div>
</template>
