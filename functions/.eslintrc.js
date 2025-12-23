module.exports = {
    root: true,
    env: {
        es2022: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:import/errors",
        "plugin:import/warnings",
        "plugin:import/typescript",
        "google",
        "plugin:@typescript-eslint/recommended",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        project: ["tsconfig.json"],
        sourceType: "module",
    },
    ignorePatterns: [
        "/lib/**/*",
        "/node_modules/**/*",
    ],
    plugins: [
        "@typescript-eslint",
        "import",
    ],
    rules: {
        "quotes": ["error", "double"],
        "import/no-unresolved": 0,
        "indent": ["error", 2],
        "max-len": ["error", { "code": 120 }],
        "object-curly-spacing": ["error", "always"],
        "require-jsdoc": 0,
        "valid-jsdoc": 0,
    },
};
