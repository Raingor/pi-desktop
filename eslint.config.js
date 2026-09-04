import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Lint rules, kept deliberately narrow.
//
// The point of adding a linter to a project that has lived without one is to
// catch the mistakes type-checking cannot see — not to relitigate style, and
// not to declare 80 pre-existing lines broken on day one. So: no formatting
// rules, and anything that reports a design opinion rather than a defect is a
// warning. `npm run lint` fails on errors only, which is what CI gates on.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "node_modules/**",
      // Emitted by Vite's PWA plugin, not written by hand.
      "public/sw.js",
      // Local agent scratch space, already gitignored. The puppeteer profile
      // under .pi/ carries vendored Chrome extension bundles, and linting those
      // reported 584 errors in third-party minified JS on any machine where the
      // browser tooling had run.
      ".pi/**",
      ".pi-subagents/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // `catch {}` is a deliberate idiom throughout the readers: a session file
      // that cannot be parsed is skipped, not reported. Empty blocks anywhere
      // else are still worth flagging.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // A `let` that a closure reads before the assignment happens cannot be a
      // const — the timeout handles in the child-process helpers are declared
      // early precisely so the cleanup function can see them.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],

      // A leading underscore is this codebase's existing way of saying "this
      // binding exists to be skipped" — in destructuring and in the callbacks
      // Electron hands an unused event object.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // Every `any` here sits on a boundary with foreign data: JSONL written by
      // other versions of pi, provider /models payloads, the preload IPC
      // bridge. The code narrows those shapes by hand. Worth seeing in new
      // code, not worth failing a build over.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // The renderer. Browser globals, and the hook rules apply here only.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // rules-of-hooks stays an error: breaking it is always a bug.
      "react-hooks/rules-of-hooks": "error",

      // The React Compiler diagnostics that v7 added are a different kind of
      // check — they report code the compiler cannot safely memoise, which in
      // this codebase is mostly load-on-mount effects written before the rule
      // existed. Each one is a real refactor with its own regression risk, so
      // they advise rather than block. Clearing them is worth doing per
      // component, not in one sweep.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },

  // Everything that runs in Node: the API layer, the Electron main process,
  // build scripts, the pi extension and the standalone test files.
  {
    files: [
      "server/**/*.ts",
      "electron/**/*.ts",
      "scripts/**/*.mjs",
      "extensions/**/*.js",
      "pi-package/**/*.ts",
      "test/**/*.js",
      "test/**/*.ts",
      "src/usage.js",
      "*.config.ts",
      "*.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
  },

  // Both of these load CommonJS on purpose. vite.config.ts defers the API route
  // table to configureServer so the server modules stay out of the browser
  // build graph; main.ts is compiled to CJS for the Electron main process.
  {
    files: ["vite.config.ts", "electron/main.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
