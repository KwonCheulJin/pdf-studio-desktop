import { defineConfig, Plugin } from "vite";
import { builtinModules } from "module";
import fs from "fs-extra";
import path from "path";

// Sharp 네이티브 모듈과 의존성 복사 플러그인
function copySharpPlugin(): Plugin {
  return {
    name: "copy-sharp-binaries",
    closeBundle: async () => {
      const buildOutput = path.join(process.cwd(), ".vite", "build");
      const nodeModulesDest = path.join(buildOutput, "node_modules");

      // sharp와 그 의존성들 복사
      const modulesToCopy = [
        "sharp",
        "@img",
        "detect-libc",
        "color",
        "color-string",
        "color-name",
        "simple-swizzle",
        "semver"
      ];

      for (const moduleName of modulesToCopy) {
        const source = path.join(process.cwd(), "node_modules", moduleName);
        const dest = path.join(nodeModulesDest, moduleName);

        if (await fs.pathExists(source)) {
          await fs.copy(source, dest);
          console.log(`✓ ${moduleName} copied to build output`);
        }
      }
    }
  };
}

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        "electron",
        "sharp",
        ...builtinModules.flatMap((m) => [m, `node:${m}`])
      ]
    }
  },
  plugins: [copySharpPlugin()]
});
