import { app, BrowserWindow, Menu, nativeTheme } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { registerIpcHandlers } from "./ipc-handler";
import { WINDOW_CONFIG } from "../config/constants";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_CONFIG.WIDTH,
    height: WINDOW_CONFIG.HEIGHT,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

function sendThemeToRenderer(window: BrowserWindow): void {
  const isDark = nativeTheme.shouldUseDarkColors;
  window.webContents.send("theme:changed", isDark);
}

app.whenReady().then(() => {
  // macOS 메뉴 설정 (경고 방지)
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        },
        {
          label: "편집",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" }
          ]
        },
        {
          label: "보기",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" }
          ]
        },
        {
          label: "윈도우",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" }
          ]
        }
      ])
    );
  }

  registerIpcHandlers();
  createWindow();

  if (mainWindow) {
    mainWindow.webContents.on("did-finish-load", () => {
      if (mainWindow) {
        sendThemeToRenderer(mainWindow);
      }
    });

    nativeTheme.on("updated", () => {
      if (mainWindow) {
        sendThemeToRenderer(mainWindow);
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
