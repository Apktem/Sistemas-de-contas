import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const pwaFiles = ["manifest.webmanifest", "service-worker.js", "icon.svg"];

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "copy-pwa-files",
      closeBundle() {
        mkdirSync(resolve("dist"), { recursive: true });
        pwaFiles.forEach((file) => {
          copyFileSync(resolve(file), resolve("dist", file));
        });
      },
    },
  ],
});
