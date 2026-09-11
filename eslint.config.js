import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Lint policy follows CONTEXT.md § Engineering standards:
 *   - files <= 400 lines, functions <= 50 lines, bounded complexity
 *   - ERROR under src/sync/** and the rebuilt src/data/ layers (dto, supabase)
 *   - WARN everywhere else, including src/data/db.ts and friends, which
 *     graduate to ERROR when their own refactor pass lands
 *   - tests and src/lib/i18n.ts are exempt from the size limits
 */

const sizeLimits = {
  "max-lines": [
    "error",
    { max: 400, skipBlankLines: true, skipComments: true },
  ],
  "max-lines-per-function": [
    "error",
    { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  complexity: ["error", 12],
};

const sizeLimitsWarn = Object.fromEntries(
  Object.entries(sizeLimits).map(([rule, [, ...opts]]) => [
    rule,
    ["warn", ...opts],
  ]),
);

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "docs/**",
      "*.config.js",
      "*.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...sizeLimitsWarn,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    files: [
      "src/sync/**/*.{ts,tsx}",
      "src/domain/**/*.{ts,tsx}",
      "src/data/supabase/**/*.{ts,tsx}",
    ],
    rules: {
      ...sizeLimits,
      // A bidirectional merge (planReconciliation) has real branching; 15 still
      // catches a genuinely tangled function without forcing a pure algorithm
      // to be sliced into helpers that only add indirection.
      complexity: ["error", 15],
    },
  },

  {
    // The DTO layer is row mappers: one `?? null` per nullable column reads as
    // branching to `complexity`, but a flat field map is the opposite of
    // complex, and splitting it to satisfy the metric only adds indirection.
    // Size limits still apply — a mapper file that grows past 400 lines is
    // doing more than mapping.
    files: ["src/data/dto/**/*.{ts,tsx}"],
    rules: { ...sizeLimits, complexity: "off" },
  },

  {
    // The whole state layer has had its refactor pass, so it is held to the
    // standard — except `max-lines-per-function`, which reads a slice factory
    // (an object literal of actions) as one enormous function. The methods
    // inside one are each held to the limit by review.
    files: ["src/state/**/*.ts", "src/data/localDocument.ts"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 12],
      "max-lines-per-function": "off",
    },
  },

  {
    files: [
      "src/**/*.test.{ts,tsx}",
      "src/test/**/*.{ts,tsx}",
      "src/**/__tests__/**/*.{ts,tsx}",
      "src/lib/i18n.ts",
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
);
