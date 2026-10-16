import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  if (command === "serve") {
    return {
      root: "examples",
      server: { host: "127.0.0.1", port: 4173 },
    };
  }

  return {
    plugins: [{
      name: "canvas-devtools-panel-css",
      apply: "build",
      buildStart() {
        this.emitFile({
          type: "asset",
          fileName: "panel.css",
          source: readFileSync(new URL("./src/panel.css", import.meta.url), "utf8"),
        });
      },
    }],
    build: {
      lib: {
        entry: {
          index: new URL("src/index.ts", import.meta.url).pathname,
          core: new URL("src/core.ts", import.meta.url).pathname,
          panel: new URL("src/panel.ts", import.meta.url).pathname,
          auto: new URL("src/auto.ts", import.meta.url).pathname,
        },
        formats: ["es"],
      },
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          preserveModules: true,
          preserveModulesRoot: new URL("./src/", import.meta.url).pathname,
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  };
});
