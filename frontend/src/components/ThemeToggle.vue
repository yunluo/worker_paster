<script setup lang="ts">
import { ref } from "vue";
import { applyTheme, loadTheme, nextTheme, saveTheme, type ThemeChoice } from "../lib/theme";

const theme = ref<ThemeChoice>(loadTheme());

const LABEL: Record<ThemeChoice, string> = {
  light: "☀️ 浅色",
  dark: "🌙 深色",
  system: "🌓 跟随系统",
};

function cycle(): void {
  theme.value = nextTheme(theme.value);
  saveTheme(theme.value);
  applyTheme(theme.value);
}
</script>

<template>
  <button class="theme-toggle" :aria-label="`切换主题（当前：${LABEL[theme]}）`" @click="cycle">{{ LABEL[theme] }}</button>
</template>
