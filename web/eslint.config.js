import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/api/schema.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        document: "readonly",
        fetch: "readonly",
        File: "readonly",
        FormData: "readonly",
        HTMLElement: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        RequestInit: "readonly",
        sessionStorage: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    plugins: { "react-refresh": reactRefresh },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-empty-pattern": "off",
      "react-refresh/only-export-components": "off",
    },
  },
);
