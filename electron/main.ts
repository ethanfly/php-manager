import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import { join } from "path";
import { PhpManager } from "./services/PhpManager";
import { MysqlManager } from "./services/MysqlManager";
import { NginxManager } from "./services/NginxManager";
import { RedisManager } from "./services/RedisManager";
import { NodeManager } from "./services/NodeManager";
import { ServiceManager } from "./services/ServiceManager";
import { HostsManager } from "./services/HostsManager";
import { ConfigStore } from "./services/ConfigStore";

// 获取托盘图标路径 (使用 PNG)
function getTrayIconPath(): string {
  const { existsSync } = require("fs");
  const paths = [
    join(__dirname, "../public/icon.png"),
    join(__dirname, "../dist/icon.png"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return join(__dirname, "../public/icon.svg");
}

// 获取窗口图标路径 (使用 SVG)
function getWindowIconPath(): string {
  const { existsSync } = require("fs");
  const paths = [
    join(__dirname, "../public/icon.svg"),
    join(__dirname, "../dist/icon.svg"),
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return join(__dirname, "../public/icon.png");
}

// 创建托盘图标
function createTrayIcon(): Electron.NativeImage {
  const iconPath = getTrayIconPath();
  console.log("Tray icon path:", iconPath);
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      // 托盘图标需要较小尺寸
      return icon.resize({ width: 16, height: 16 });
    }
  } catch (e) {
    console.error("Failed to load tray icon:", e);
  }
  return nativeImage.createEmpty();
}

// 创建窗口图标
function createWindowIcon(): Electron.NativeImage {
  const iconPath = getWindowIconPath();
  console.log("Window icon path:", iconPath);
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  } catch (e) {
    console.error("Failed to load window icon:", e);
  }
  return nativeImage.createEmpty();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// 发送下载进度到渲染进程
export function sendDownloadProgress(
  type: string,
  progress: number,
  downloaded: number,
  total: number
) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("download-progress", {
      type,
      progress,
      downloaded,
      total,
    });
  }
}

// 初始化各服务管理器
const configStore = new ConfigStore();
const phpManager = new PhpManager(configStore);
const mysqlManager = new MysqlManager(configStore);
const nginxManager = new NginxManager(configStore);
const redisManager = new RedisManager(configStore);
const nodeManager = new NodeManager(configStore);
const serviceManager = new ServiceManager(configStore);
const hostsManager = new HostsManager();

function createWindow() {
  const appIcon = createWindowIcon();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#1a1a2e",
      symbolColor: "#ffffff",
      height: 40,
    },
    frame: false,
    icon: appIcon,
    show: false, // 先不显示，等 ready-to-show
  });

  // 开发环境加载 Vite 开发服务器
  const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  // 窗口准备好后显示
  mainWindow.once("ready-to-show", () => {
    // 检查是否开机自启且静默启动
    const startMinimized = configStore.get("startMinimized");
    if (!startMinimized) {
      mainWindow?.show();
    }
  });

  // 关闭按钮改为最小化到托盘
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 创建系统托盘
function createTray() {
  // 创建托盘图标
  const trayIcon = createTrayIcon();

  tray = new Tray(trayIcon);
  tray.setToolTip("PHPer 开发环境管理器");

  // 创建托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "启动全部服务",
      click: async () => {
        const result = await serviceManager.startAll();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("service-status-changed");
        }
      },
    },
    {
      label: "停止全部服务",
      click: async () => {
        const result = await serviceManager.stopAll();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("service-status-changed");
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标显示窗口
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

app.whenReady().then(async () => {
  createTray();
  createWindow();

  // 检查是否启用开机自启且自动启动服务
  const autoStartServices = configStore.get("autoStartServicesOnBoot");
  if (autoStartServices) {
    await serviceManager.startAll();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 不要在所有窗口关闭时退出，保持托盘运行
app.on("window-all-closed", () => {
  // 什么都不做，保持后台运行
});

// 真正退出前清理
app.on("before-quit", () => {
  isQuitting = true;
});

// ==================== IPC 处理程序 ====================

// 窗口控制
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());

// 打开外部链接
ipcMain.handle("shell:openExternal", (_, url: string) =>
  shell.openExternal(url)
);
ipcMain.handle("shell:openPath", (_, path: string) => shell.openPath(path));

// 选择文件夹对话框
ipcMain.handle("dialog:selectDirectory", async () => {
  const { dialog } = await import("electron");
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "选择目录",
  });
  return result.canceled ? null : result.filePaths[0];
});

// ==================== PHP 管理 ====================
ipcMain.handle("php:getVersions", () => phpManager.getInstalledVersions());
ipcMain.handle("php:getAvailableVersions", () =>
  phpManager.getAvailableVersions()
);
ipcMain.handle("php:install", (_, version: string) =>
  phpManager.install(version)
);
ipcMain.handle("php:uninstall", (_, version: string) =>
  phpManager.uninstall(version)
);
ipcMain.handle("php:setActive", (_, version: string) =>
  phpManager.setActive(version)
);
ipcMain.handle("php:getExtensions", (_, version: string) =>
  phpManager.getExtensions(version)
);
ipcMain.handle("php:openExtensionDir", (_, version: string) =>
  phpManager.openExtensionDir(version)
);
ipcMain.handle(
  "php:getAvailableExtensions",
  (_, version: string, searchKeyword?: string) =>
    phpManager.getAvailableExtensions(version, searchKeyword)
);
ipcMain.handle("php:enableExtension", (_, version: string, ext: string) =>
  phpManager.enableExtension(version, ext)
);
ipcMain.handle("php:disableExtension", (_, version: string, ext: string) =>
  phpManager.disableExtension(version, ext)
);
ipcMain.handle(
  "php:installExtension",
  (
    _,
    version: string,
    ext: string,
    downloadUrl?: string,
    packageName?: string
  ) => phpManager.installExtension(version, ext, downloadUrl, packageName)
);
ipcMain.handle("php:getConfig", (_, version: string) =>
  phpManager.getConfig(version)
);
ipcMain.handle("php:saveConfig", (_, version: string, config: string) =>
  phpManager.saveConfig(version, config)
);

// ==================== MySQL 管理 ====================
ipcMain.handle("mysql:getVersions", () => mysqlManager.getInstalledVersions());
ipcMain.handle("mysql:getAvailableVersions", () =>
  mysqlManager.getAvailableVersions()
);
ipcMain.handle("mysql:install", (_, version: string) =>
  mysqlManager.install(version)
);
ipcMain.handle("mysql:uninstall", (_, version: string) =>
  mysqlManager.uninstall(version)
);
ipcMain.handle("mysql:start", (_, version: string) =>
  mysqlManager.start(version)
);
ipcMain.handle("mysql:stop", (_, version: string) =>
  mysqlManager.stop(version)
);
ipcMain.handle("mysql:restart", (_, version: string) =>
  mysqlManager.restart(version)
);
ipcMain.handle("mysql:getStatus", (_, version: string) =>
  mysqlManager.getStatus(version)
);
ipcMain.handle(
  "mysql:changePassword",
  (_, version: string, newPassword: string, currentPassword?: string) =>
    mysqlManager.changeRootPassword(version, newPassword, currentPassword)
);
ipcMain.handle("mysql:getConfig", (_, version: string) =>
  mysqlManager.getConfig(version)
);
ipcMain.handle("mysql:saveConfig", (_, version: string, config: string) =>
  mysqlManager.saveConfig(version, config)
);
ipcMain.handle("mysql:reinitialize", (_, version: string) =>
  mysqlManager.reinitialize(version)
);

// ==================== Nginx 管理 ====================
ipcMain.handle("nginx:getVersions", () => nginxManager.getInstalledVersions());
ipcMain.handle("nginx:getAvailableVersions", () =>
  nginxManager.getAvailableVersions()
);
ipcMain.handle("nginx:install", (_, version: string) =>
  nginxManager.install(version)
);
ipcMain.handle("nginx:uninstall", (_, version: string) =>
  nginxManager.uninstall(version)
);
ipcMain.handle("nginx:start", () => nginxManager.start());
ipcMain.handle("nginx:stop", () => nginxManager.stop());
ipcMain.handle("nginx:restart", () => nginxManager.restart());
ipcMain.handle("nginx:reload", () => nginxManager.reload());
ipcMain.handle("nginx:getStatus", () => nginxManager.getStatus());
ipcMain.handle("nginx:getConfig", () => nginxManager.getConfig());
ipcMain.handle("nginx:saveConfig", (_, config: string) =>
  nginxManager.saveConfig(config)
);
ipcMain.handle("nginx:getSites", () => nginxManager.getSites());
ipcMain.handle("nginx:addSite", (_, site: any) => nginxManager.addSite(site));
ipcMain.handle("nginx:removeSite", (_, name: string) =>
  nginxManager.removeSite(name)
);
ipcMain.handle("nginx:updateSite", (_, originalName: string, site: any) =>
  nginxManager.updateSite(originalName, site)
);
ipcMain.handle("nginx:enableSite", (_, name: string) =>
  nginxManager.enableSite(name)
);
ipcMain.handle("nginx:disableSite", (_, name: string) =>
  nginxManager.disableSite(name)
);
ipcMain.handle("nginx:generateLaravelConfig", (_, site: any) =>
  nginxManager.generateLaravelConfig(site)
);
ipcMain.handle("nginx:requestSSL", (_, domain: string, email: string) =>
  nginxManager.requestSSLCertificate(domain, email)
);

// ==================== Redis 管理 ====================
ipcMain.handle("redis:getVersions", () => redisManager.getInstalledVersions());
ipcMain.handle("redis:getAvailableVersions", () =>
  redisManager.getAvailableVersions()
);
ipcMain.handle("redis:install", (_, version: string) =>
  redisManager.install(version)
);
ipcMain.handle("redis:uninstall", (_, version: string) =>
  redisManager.uninstall(version)
);
ipcMain.handle("redis:start", () => redisManager.start());
ipcMain.handle("redis:stop", () => redisManager.stop());
ipcMain.handle("redis:restart", () => redisManager.restart());
ipcMain.handle("redis:getStatus", () => redisManager.getStatus());
ipcMain.handle("redis:getConfig", () => redisManager.getConfig());
ipcMain.handle("redis:saveConfig", (_, config: string) =>
  redisManager.saveConfig(config)
);

// ==================== Node.js 管理 ====================
ipcMain.handle("node:getVersions", () => nodeManager.getInstalledVersions());
ipcMain.handle("node:getAvailableVersions", () =>
  nodeManager.getAvailableVersions()
);
ipcMain.handle("node:install", (_, version: string, downloadUrl: string) =>
  nodeManager.install(version, downloadUrl)
);
ipcMain.handle("node:uninstall", (_, version: string) =>
  nodeManager.uninstall(version)
);
ipcMain.handle("node:setActive", (_, version: string) =>
  nodeManager.setActive(version)
);
ipcMain.handle("node:getInfo", (_, version: string) =>
  nodeManager.getNodeInfo(version)
);

// ==================== 服务管理 ====================
ipcMain.handle("service:getAll", () => serviceManager.getAllServices());
ipcMain.handle("service:setAutoStart", (_, service: string, enabled: boolean) =>
  serviceManager.setAutoStart(service, enabled)
);
ipcMain.handle("service:getAutoStart", (_, service: string) =>
  serviceManager.getAutoStart(service)
);
ipcMain.handle("service:startAll", () => serviceManager.startAll());
ipcMain.handle("service:stopAll", () => serviceManager.stopAll());

// ==================== Hosts 管理 ====================
ipcMain.handle("hosts:get", () => hostsManager.getHosts());
ipcMain.handle("hosts:add", (_, domain: string, ip: string) =>
  hostsManager.addHost(domain, ip)
);
ipcMain.handle("hosts:remove", (_, domain: string) =>
  hostsManager.removeHost(domain)
);

// ==================== 配置管理 ====================
ipcMain.handle("config:get", (_, key: string) => configStore.get(key));
ipcMain.handle("config:set", (_, key: string, value: any) =>
  configStore.set(key, value)
);
ipcMain.handle("config:getBasePath", () => configStore.getBasePath());
ipcMain.handle("config:setBasePath", (_, path: string) =>
  configStore.setBasePath(path)
);

// ==================== 应用设置 ====================
// 设置开机自启
ipcMain.handle("app:setAutoLaunch", async (_, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // 静默启动
    args: ["--hidden"],
  });
  configStore.set("autoLaunch", enabled);
  return {
    success: true,
    message: enabled ? "已启用开机自启" : "已禁用开机自启",
  };
});

// 获取开机自启状态
ipcMain.handle("app:getAutoLaunch", () => {
  return app.getLoginItemSettings().openAtLogin;
});

// 设置启动时最小化到托盘
ipcMain.handle("app:setStartMinimized", (_, enabled: boolean) => {
  configStore.set("startMinimized", enabled);
  return { success: true };
});

// 获取启动时最小化状态
ipcMain.handle("app:getStartMinimized", () => {
  return configStore.get("startMinimized") || false;
});

// 设置开机自启时自动启动服务
ipcMain.handle("app:setAutoStartServices", (_, enabled: boolean) => {
  configStore.set("autoStartServicesOnBoot", enabled);
  return { success: true };
});

// 获取自动启动服务状态
ipcMain.handle("app:getAutoStartServices", () => {
  return configStore.get("autoStartServicesOnBoot") || false;
});

// 真正退出应用
ipcMain.handle("app:quit", () => {
  isQuitting = true;
  app.quit();
});
