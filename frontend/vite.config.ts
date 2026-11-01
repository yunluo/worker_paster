import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 本地 vite dev server 上把 /api 代理到 wrangler dev
      "/api": "http://127.0.0.1:8787",
    },
  },
});
