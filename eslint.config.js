import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
    ],
    ignores: ["src/lib/**/*", "src/components/ui/**/*"],
    ...pluginJs.configs.recommended,
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Guards EVERY src file — including src/lib, which the block above
    // deliberately ignores. That gap is how `import.meta?.env` shipped
    // unlinted and broke customer proof viewing (#680/#681): Vite only
    // statically replaces the bare `import.meta.env.X` form, so any optional
    // chaining on import.meta reaches the browser, where import.meta.env is
    // undefined at runtime. scripts/check-dist-env.mjs is the build-time
    // backstop for the same class.
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Registered (not enabled) so inline `eslint-disable react-hooks/*`
    // comments in src/lib files resolve now that this block lints them.
    plugins: { "react-hooks": pluginReactHooks },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // import.meta?.env — the ?. sits BEFORE the env key, so Vite can't
          // statically replace it and the browser sees undefined.
          selector: "MemberExpression[optional=true][object.type='MetaProperty']",
          message:
            "`import.meta?.env` defeats Vite's static env replacement — use the bare import.meta.env.X form (customer-facing regression #680).",
        },
        {
          // import.meta.env?.X — same failure, ?. on the env object itself.
          // (import.meta.env.X?.method() is FINE: the env key is replaced
          // first, the optional call operates on the literal.)
          selector: "MemberExpression[optional=true][object.object.type='MetaProperty']",
          message:
            "`import.meta.env?.X` defeats Vite's static env replacement — use the bare import.meta.env.X form (customer-facing regression #680).",
        },
      ],
    },
  },
];
