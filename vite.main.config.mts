import { defineConfig, Plugin } from "vite";
import { builtinModules } from "module";
import fs from "fs-extra";
import path from "path";

// 네이티브 모듈 및 CJS interop 문제 모듈 복사 플러그인
function copyNativeModulesPlugin(): Plugin {
  return {
    name: "copy-native-modules",
    closeBundle: async () => {
      const buildOutput = path.join(process.cwd(), ".vite", "build");
      const nodeModulesDest = path.join(buildOutput, "node_modules");

      const modulesToCopy = [
        // sharp 네이티브 모듈
        "sharp",
        "@img",
        "detect-libc",
        "color",
        "color-string",
        "color-name",
        "simple-swizzle",
        "semver",
        // pdf-lib (Rolldown CJS interop 버그 우회)
        "pdf-lib",
        "@pdf-lib/standard-fonts",
        "@pdf-lib/upng",
        "pako"
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
    rolldownOptions: {
      external: [
        "electron",
        "sharp",
        "pdf-lib",
        ...builtinModules.flatMap((m) => [m, `node:${m}`])
      ]
    }
  },
  plugins: [copyNativeModulesPlugin()]
});
