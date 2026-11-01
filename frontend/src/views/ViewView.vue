<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { decryptText } from "../lib/crypto";
import { highlight, langLabel } from "../lib/highlight";

type State = "loading" | "ready" | "nokey" | "notfound" | "decrypterror" | "network";

const route = useRoute();
const state = ref<State>("loading");
const text = ref("");
const lang = ref("plaintext");
const createdAt = ref<number | null>(null);
const expiresAt = ref<number | null>(null);

const lineCount = computed(() => text.value.split("\n").length);
const html = computed(() => highlight(text.value, lang.value));

onMounted(load);

// 仅 hash 变化（如先打开 /id 后补 #密钥）不会重新挂载组件，侦听路由变化重跑加载
watch(() => route.fullPath, load);

async function load(): Promise<void> {
  state.value = "loading";
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
    };
    lang.value = data.lang;
    createdAt.value = data.created_at;
    expiresAt.value = data.expires_at;
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

async function copyText(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value);
  } catch {
    // 剪贴板不可用（权限/非安全上下文）：静默失败，用户可手动选择文本
  }
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
        </span>
        <button @click="copyText">复制原文</button>
      </div>
      <div class="code-wrap">
        <div class="gutter">
          <span v-for="n in lineCount" :key="n">{{ n }}</span>
        </div>
        <pre class="code"><code v-html="html"></code></pre>
      </div>
    </template>
  </div>
</template>
