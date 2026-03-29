#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, "../package.json");

const { version } = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const tag = `v${version}`;

try {
  execSync(`git add package.json`, { stdio: "inherit" });
  execSync(
    `git commit -m "chore: release ${tag}"`,
    { stdio: "inherit" }
  );
  execSync(`git tag ${tag}`, { stdio: "inherit" });
  execSync(`git push origin main --follow-tags`, { stdio: "inherit" });

  console.log(`\n✅ Released ${tag} successfully.`);
} catch (error) {
  console.error(`\n❌ Release failed: ${error.message}`);
  process.exit(1);
}
