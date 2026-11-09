import { defineConfig } from "vite";

// GitHub Pages serves the site at https://song11071696.github.io/airlock/ , so production assets need that base.
// Override with VITE_BASE=/ for Firebase Hosting or a custom domain.
export default defineConfig(({ command }) => ({
  base: command === "build" ? process.env.VITE_BASE || "/airlock/" : "/",
}));
