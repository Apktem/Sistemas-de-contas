import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const publicFiles = ["manifest.webmanifest", "service-worker.js", "robots.txt", "sitemap.xml"];

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "copy-pwa-files",
      closeBundle() {
        mkdirSync(resolve("dist"), { recursive: true });
        publicFiles.forEach((file) => {
          copyFileSync(resolve(file), resolve("dist", file));
        });
        mkdirSync(resolve("dist", "assets"), { recursive: true });
        ["ricoxp-icon-32.png", "ricoxp-icon-180.png", "ricoxp-icon-192.png", "ricoxp-icon-512.png", "ricoxp-social.png"].forEach((file) => {
          copyFileSync(resolve("assets", file), resolve("dist", "assets", file));
        });
      },
    },
  ],
});
