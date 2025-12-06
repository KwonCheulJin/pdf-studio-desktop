import path from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [
  // 공통 settings
  {
    settings: {
      react: {
        version: "detect"
      },
      "import/resolver": {
        typescript: {}
      }
    }
  },

  // 예전 extends 목록을 그대로 가져오기
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:prettier/recommended"
  ),

  // 무시할 파일/폴더
  {
    ignores: ["dist", ".eslintrc.cjs"]
  },

  // 실제로 우리가 커스터마이징할 메인 룰들
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parserOptions: {
        sourceType: "module",
        ecmaVersion: 11,
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.es2020
      }
    },
    plugins: {
      "unused-imports": unusedImports
    },
    rules: {
      "prettier/prettier": ["error", { endOfLine: "auto" }],

      // 기본 no-unused-vars는 끄고, unused-imports에 위임
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // unused-imports로 import + 변수 관리
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_"
        }
      ],

      "no-const-assign": "error",
      "no-var": "warn",
      "no-new-object": "error",
      "object-shorthand": "error",
      "prefer-object-spread": "error",
      "no-array-constructor": "error",
      "array-callback-return": "warn",
      quotes: ["error", "double"],
      "prefer-template": "error",
      "template-curly-spacing": "error",
      "no-eval": "error",
      "no-useless-escape": "error",
      "default-param-last": "error",
      "no-new-func": "error",
      "space-before-function-paren": [
        "error",
        {
          anonymous: "always",
          named: "never",
          asyncArrow: "always"
        }
      ],
      "space-before-blocks": "error",
      "no-param-reassign": "error",
      "prefer-spread": "error",
      "prefer-arrow-callback": "error",
      "arrow-spacing": "error",
      "arrow-parens": ["error", "always"],

      // React 17+ JSX transform 대응
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react-hooks/exhaustive-deps": "off"
    }
  }
];
