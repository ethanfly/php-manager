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
import { GitManager } from "./services/GitManager";
import { PythonManager } from "./services/PythonManager";
import { ConfigStore } from "./services/ConfigStore";

// 获取图标路径
function getIconPath(filename: string): string {
  const { existsSync } = require("fs");

  // 打包后的路径
  if (app.isPackaged) {
    const paths = [
      join(process.resourcesPath, "public", filename),
      join(process.resourcesPath, filename),
      join(__dirname, "../public", filename),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  // 开发环境路径
  const devPaths = [
    join(__dirname, "../public", filename),
    join(__dirname, "../dist", filename),
  ];
  for (const p of devPaths) {
    if (existsSync(p)) return p;
  }

  return join(__dirname, "../public/icon.ico");
}

// 获取托盘图标路径
function getTrayIconPath(): string {
  return getIconPath("icon.ico");
}

// 获取窗口图标路径
function getWindowIconPath(): string {
  return getIconPath("icon.ico");
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
const gitManager = new GitManager(configStore);
const pythonManager = new PythonManager(configStore);

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

// 单实例锁定
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果获取不到锁，说明已有实例在运行，退出当前实例
  app.quit();
} else {
  // 当第二个实例启动时，聚焦到第一个实例的窗口
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createTray();
    createWindow();

    // 根据配置自动启动服务
    try {
      const result = await serviceManager.startAutoStartServices();
      if (result.details.length > 0) {
        console.log("自动启动服务:", result.details.join(", "));
      }
    } catch (error) {
      console.error("自动启动服务失败:", error);
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
}

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

// ==================== Composer 管理 ====================
ipcMain.handle("composer:getStatus", () => phpManager.getComposerStatus());
ipcMain.handle("composer:install", () => phpManager.installComposer());
ipcMain.handle("composer:uninstall", () => phpManager.uninstallComposer());
ipcMain.handle("composer:setMirror", (_, mirror: string) =>
  phpManager.setComposerMirror(mirror)
);
ipcMain.handle(
  "composer:createLaravelProject",
  (_, projectName: string, targetDir: string) =>
    phpManager.createLaravelProject(projectName, targetDir)
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
// PHP-CGI 管理 - 支持多版本
ipcMain.handle("service:getPhpCgiStatus", () => serviceManager.getPhpCgiStatus());
ipcMain.handle("service:startPhpCgi", () => serviceManager.startPhpCgi());
ipcMain.handle("service:stopPhpCgi", () => serviceManager.stopPhpCgi());
ipcMain.handle("service:startAllPhpCgi", () => serviceManager.startAllPhpCgi());
ipcMain.handle("service:stopAllPhpCgi", () => serviceManager.stopAllPhpCgi());
ipcMain.handle("service:startPhpCgiVersion", (_, version: string) => serviceManager.startPhpCgiVersion(version));
ipcMain.handle("service:stopPhpCgiVersion", (_, version: string) => serviceManager.stopPhpCgiVersion(version));
ipcMain.handle("service:getPhpCgiPort", (_, version: string) => serviceManager.getPhpCgiPort(version));

// ==================== Hosts 管理 ====================
ipcMain.handle("hosts:get", () => hostsManager.getHosts());
ipcMain.handle("hosts:add", (_, domain: string, ip: string) =>
  hostsManager.addHost(domain, ip)
);
ipcMain.handle("hosts:remove", (_, domain: string) =>
  hostsManager.removeHost(domain)
);

// ==================== Git 管理 ====================
ipcMain.handle("git:getVersions", () => gitManager.getInstalledVersions());
ipcMain.handle("git:getAvailableVersions", () =>
  gitManager.getAvailableVersions()
);
ipcMain.handle("git:install", (_, version: string) =>
  gitManager.install(version)
);
ipcMain.handle("git:uninstall", () => gitManager.uninstall());
ipcMain.handle("git:checkSystem", () => gitManager.checkSystemGit());
ipcMain.handle("git:getConfig", () => gitManager.getGitConfig());
ipcMain.handle("git:setConfig", (_, name: string, email: string) =>
  gitManager.setGitConfig(name, email)
);

// ==================== Python 管理 ====================
ipcMain.handle("python:getVersions", () => pythonManager.getInstalledVersions());
ipcMain.handle("python:getAvailableVersions", () =>
  pythonManager.getAvailableVersions()
);
ipcMain.handle("python:install", (_, version: string) =>
  pythonManager.install(version)
);
ipcMain.handle("python:uninstall", (_, version: string) =>
  pythonManager.uninstall(version)
);
ipcMain.handle("python:setActive", (_, version: string) =>
  pythonManager.setActive(version)
);
ipcMain.handle("python:checkSystem", () => pythonManager.checkSystemPython());
ipcMain.handle("python:getPipInfo", (_, version: string) =>
  pythonManager.getPipInfo(version)
);
ipcMain.handle(
  "python:installPackage",
  (_, version: string, packageName: string) =>
    pythonManager.installPackage(version, packageName)
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
// 设置开机自启（以管理员模式，使用任务计划程序）
ipcMain.handle("app:setAutoLaunch", async (_, enabled: boolean) => {
  const { execSync } = require("child_process");
  const exePath = app.getPath("exe");
  const taskName = "PHPerDevManager";

  // 开发模式下不支持
  if (!app.isPackaged) {
    return {
      success: false,
      message: "开发模式下不支持开机自启，请打包后使用",
    };
  }

  try {
    if (enabled) {
      // 先删除可能存在的旧任务
      try {
        execSync(`schtasks /delete /tn "${taskName}" /f`, {
          encoding: "buffer",
          windowsHide: true,
        });
      } catch (e) {
        // 忽略删除失败（可能任务不存在）
      }

      // 创建任务计划程序任务，以最高权限运行
      const command = `schtasks /create /tn "${taskName}" /tr "\\"${exePath}\\"" /sc onlogon /rl highest /f`;
      execSync(command, { encoding: "buffer", windowsHide: true });

      configStore.set("autoLaunch", true);
      return { success: true, message: "已启用开机自启（管理员模式）" };
    } else {
      // 删除任务计划程序任务
      try {
        execSync(`schtasks /delete /tn "${taskName}" /f`, {
          encoding: "buffer",
          windowsHide: true,
        });
      } catch (e) {
        // 忽略删除失败
      }
      configStore.set("autoLaunch", false);
      return { success: true, message: "已禁用开机自启" };
    }
  } catch (error: any) {
    console.error("任务计划操作失败:", error);
    return {
      success: false,
      message: "操作失败，请确保应用以管理员身份运行",
    };
  }
});

// 获取开机自启状态
ipcMain.handle("app:getAutoLaunch", async () => {
  const { execSync } = require("child_process");
  const taskName = "PHPerDevManager";

  // 开发模式下返回 false
  if (!app.isPackaged) {
    return false;
  }

  try {
    execSync(`schtasks /query /tn "${taskName}"`, {
      encoding: "buffer",
      windowsHide: true,
    });
    return true;
  } catch (e) {
    return false;
  }
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

// 真正退出应用
ipcMain.handle("app:quit", () => {
  isQuitting = true;
  app.quit();
});
