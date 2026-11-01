import { createRouter, createWebHistory } from "vue-router";
import CreateView from "./views/CreateView.vue";
import ViewView from "./views/ViewView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: CreateView },
    { path: "/:id", component: ViewView },
  ],
});
