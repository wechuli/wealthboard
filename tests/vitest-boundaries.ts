export const rootTestInclude = [
  "tests/unit/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
  "tests/component/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
];

export const rootTestExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.*/**",
  "tests/docs/**",
  "tests/e2e/**",
  "web/**",
];
