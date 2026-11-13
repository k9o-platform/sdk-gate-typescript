import { defineConfig } from "tsup";

// Build the publishable artifact: bundle the `.ts`-specifier source into
// Node-resolvable ESM + emit bundled .d.ts per entry. Third-party deps
// (jose) and any @k9o/* siblings are auto-externalised from `dependencies`
// (resolved from the consumer's node_modules at runtime). One entry per
// `exports` subpath so `@k9o/gate`, `@k9o/gate/jwt`, etc. all resolve.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types.ts",
    "src/errors.ts",
    "src/jwt.ts",
    "src/mode.ts",
  ],
  format: ["esm"],
  target: "node18",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
});
