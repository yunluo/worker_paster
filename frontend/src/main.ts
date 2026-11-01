import { createApp } from "vue";
import App from "./App.vue";
import "highlight.js/styles/github-dark.css";
import { router } from "./router";
import { applyTheme, loadTheme } from "./lib/theme";
import "./style.css";

applyTheme(loadTheme());

createApp(App).use(router).mount("#app");
