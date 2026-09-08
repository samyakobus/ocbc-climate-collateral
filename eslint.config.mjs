import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // public/ is served verbatim and is not source. It holds the vendored
    // MapLibre worker copied from node_modules so the worker starts without a
    // bundler (S16), the pmtiles basemap archives, and the cached tiles and
    // thumbnails. The minified bundles alone produced about 1,083 warnings.
    // Ignoring the whole directory rather than just public/maplibre keeps a
    // future vendored asset from reintroducing the noise.
    "public/**",
  ]),
]);

export default eslintConfig;
