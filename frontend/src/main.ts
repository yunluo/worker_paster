import { createApp } from "vue";
import App from "./App.vue";
import "highlight.js/styles/github-dark.css";
import { router } from "./router";
import "./style.css";

createApp(App).use(router).mount("#app");
