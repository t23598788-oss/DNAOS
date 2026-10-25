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
  ]),

  // ===== DNA OS Layer Boundary Guards =====
  // Rule 71: V2-V5 cannot import @supabase/supabase-js directly
  // Only V6-Executor (lib/v6-executor/) and lib/supabase/ may access the database
  {
    files: [
      "lib/v2-rules/**/*.ts",
      "lib/v3-engines/**/*.ts",
      "lib/v4-ai/**/*.ts",
      "lib/v5-presenter/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@supabase/supabase-js"],
          message: "Rule 71: V2-V5 import @supabase/supabase-js ไม่ได้ — เฉพาะ V6-Executor เท่านั้นที่เข้าถึง DB ได้ ใช้ lib/supabase/queries.ts แทน",
        }],
      }],
    },
  },

  // Rule 14: V5-presenter cannot import from v3-engines
  // Presenter only formats data, must receive via function parameters
  {
    files: ["lib/v5-presenter/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/v3-engines/**"],
          message: "Rule 14: V5-Presenter ห้าม import V3-Engines โดยตรง — รับข้อมูลผ่าน function parameter เท่านั้น",
        }],
      }],
    },
  },

  // V4-AI cannot import from lib/runtime/engine
  // AI layer should not register commands into the runtime
  {
    files: ["lib/v4-ai/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/runtime/engine**"],
          message: "V4-AI ห้าม import runtime/engine — AI ไม่ควร register command เอง",
        }],
      }],
    },
  },



]);

export default eslintConfig;
