import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  splitting: false,
  // shared package TS source hai — bundle mein include karo
  noExternal: ["@pnl/shared"],
});
