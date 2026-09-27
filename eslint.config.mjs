import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Client components must never import privileged server modules.
    files: ["src/components/**/*.tsx", "src/app/**/*-form.tsx", "src/app/**/error.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/supabase/*", "@/server/env", "@/server/env-core"], message: "Server-only module." },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/types/database.ts",
    "supabase/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
