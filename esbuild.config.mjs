import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import path from "path";
import { fileURLToPath } from "url";

const prod = process.argv[2] === "production";
const pluginRoot = path.dirname(fileURLToPath(import.meta.url));

const context = await esbuild.context({
  banner: {
    js: "/* Daily Note Flow for Obsidian */"
  },
  absWorkingDir: pluginRoot,
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
