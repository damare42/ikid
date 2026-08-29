import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // ignoreRestSiblings covers `const { dropMe, ...rest } = obj` — the
      // standard way to omit a key, where the "unused" binding is the point.
      // varsIgnorePattern extends the ^_ convention beyond arguments.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
);
