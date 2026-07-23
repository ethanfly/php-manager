import { ConfigStore } from "./ConfigStore";
import { exec } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  renameSync,
} from "fs";
import { join } from "path";
import https from "https";
import http from "http";
import { createWriteStream } from "fs";
import unzipper from "unzipper";
import { sendDownloadProgress } from "../main";
import { PathManager } from "./PathManager";

const execAsync = promisify(exec);

interface GoVersion {
  version: string;
  path: string;
  isActive: boolean;
  // 来源：managed = 本应用托管；system = 用户在系统其它位置安装
  source: "managed" | "system";
}

interface AvailableGoVersion {
  version: string;
  stable: boolean;
  downloadUrl: string;
  filename: string;
}

export class GoManager {
  private configStore: ConfigStore;
  private pathManager: PathManager;
  private versionsCache: AvailableGoVersion[] = [];
  private cacheTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 分钟缓存

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pathManager = new PathManager(configStore);
  }

  /**
   * 获取已安装的 Go 版本
   */
  async getInstalledVersions(): Promise<GoVersion[]> {
    const versions: GoVersion[] = [];
    const goPath = this.configStore.getGoPath();
    const activeVersion = this.configStore.get("activeGoVersion") || "";

    if (!existsSync(goPath)) {
      return versions;
    }

    const dirs = readdirSync(goPath, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory() && dir.name.startsWith("go-")) {
        const versionDir = join(goPath, dir.name);
        const goExe = join(versionDir, "bin", "go.exe");

        if (existsSync(goExe)) {
          const version = dir.name.replace("go-", "");
          versions.push({
            version,
            path: versionDir,
            isActive: version === activeVersion,
            source: "managed",
          });
        }
      }
    }

    // 合并系统其它位置安装的 Go（where go 探测，与托管版本去重）
    const system = await this.detectSystemGo();
    if (system) {
      const managedHaveIt = versions.some(
        (v) => v.version === system.version || v.path === system.path
      );
      if (!managedHaveIt) {
        versions.push({
          version: system.version,
          path: system.path,
          isActive: system.version === activeVersion,
          source: "system",
        });
      }
    }

    versions.sort((a, b) => {
      const aParts = a.version.replace("go", "").split(".").map(Number);
      const bParts = b.version.replace("go", "").split(".").map(Number);
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) return bParts[i] - aParts[i];
      }
      return 0;
    });

    return versions;
  }

  /**
   * 检测系统已安装的 Go（用户 PATH，非本应用托管）。
   * 用 `go env GOROOT` 拿真实安装根，而非 `where go`（后者在 mise/asdf 等
   * shim 环境下返回的是 shim 目录，而非真实安装，会误导展示且卸载会误删 shim）。
   * 若 GOROOT 落在本应用托管目录(basePath/go)下，返回 null 避免与托管版本重复。
   */
  async detectSystemGo(): Promise<{ version: string; path: string } | null> {
    try {
      const { stdout: vout } = await execAsync("go version", {
        windowsHide: true,
        timeout: 8000,
      });
      const m = vout.match(/go version (go[\d.]+)/i);
      if (!m) return null;
      const version = m[1].replace(/^go/, ""); // "1.23.5"

      const { stdout: rootOut } = await execAsync("go env GOROOT", {
        windowsHide: true,
        timeout: 8000,
      });
      const root = rootOut.trim();
      if (!root) return null;
      const managedRoot = this.configStore.getGoPath().toLowerCase();
      if (root.toLowerCase().startsWith(managedRoot)) return null;
      return { version, path: root };
    } catch {
      return null;
    }
  }

  /**
   * 从 go.dev 获取可用版本列表
   */
  async getAvailableVersions(): Promise<AvailableGoVersion[]> {
    if (
      this.versionsCache.length > 0 &&
      Date.now() - this.cacheTime < this.CACHE_DURATION
    ) {
      return this.versionsCache;
    }

    try {
      const versions = await this.fetchVersionsFromGoDev();
      if (versions.length > 0) {
        this.versionsCache = versions;
        this.cacheTime = Date.now();
        return versions;
      }
    } catch (error) {
      console.error("[Go] Failed to fetch versions:", error);
    }

    return this.getFallbackVersions();
  }

  /**
   * 从 go.dev/dl API 获取版本列表
   */
  private async fetchVersionsFromGoDev(): Promise<AvailableGoVersion[]> {
    return new Promise((resolve, reject) => {
      const url = "https://go.dev/dl/?mode=json";

      https
        .get(
          url,
          {
            headers: { "User-Agent": "PHPer-Dev-Manager/1.0" },
            timeout: 30000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const releases = JSON.parse(data);
                const versions: AvailableGoVersion[] = [];

                for (const rel of releases) {
                  const winZip = rel.files?.find(
                    (f: any) =>
                      f.os === "windows" &&
                      f.arch === "amd64" &&
                      f.filename?.endsWith(".zip"),
                  );
                  if (winZip) {
                    versions.push({
                      version: rel.version,
                      stable: rel.stable ?? true,
                      downloadUrl: `https://go.dev/dl/${winZip.filename}`,
                      filename: winZip.filename,
                    });
                  }
                }

                resolve(versions.slice(0, 30));
              } catch (e) {
                reject(e);
              }
            });
          },
        )
        .on("error", reject)
        .on("timeout", () => reject(new Error("Request timeout")));
    });
  }

  /**
   * 安装 Go 版本
   */
  async install(
    version: string,
    downloadUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const goPath = this.configStore.getGoPath();
      const tempPath = this.configStore.getTempPath();
      const zipPath = join(tempPath, `go-${version}.zip`);
      const extractDir = join(tempPath, `go-extract-${version}`);
      const versionDir = join(goPath, `go-${version}`);

      if (!existsSync(goPath)) mkdirSync(goPath, { recursive: true });
      if (!existsSync(tempPath)) mkdirSync(tempPath, { recursive: true });

      if (
        existsSync(versionDir) &&
        existsSync(join(versionDir, "bin", "go.exe"))
      ) {
        return { success: false, message: `Go ${version} 已安装` };
      }

      console.log(`[Go] Downloading ${version}...`);
      await this.downloadFile(downloadUrl, zipPath, `go-${version}`);

      console.log(`[Go] Extracting ${version}...`);
      await this.extractZip(zipPath, extractDir);

      // Go zip 解压后根目录是 "go" 文件夹，需要重命名为 go-version
      const innerGoDir = join(extractDir, "go");
      if (existsSync(innerGoDir)) {
        renameSync(innerGoDir, versionDir);
      } else {
        return { success: false, message: "解压失败：未找到 go 目录" };
      }

      try {
        unlinkSync(zipPath);
        rmSync(extractDir, { recursive: true, force: true });
      } catch (e) {
        // 忽略清理错误
      }

      if (!existsSync(join(versionDir, "bin", "go.exe"))) {
        return { success: false, message: "安装失败：go.exe 不存在" };
      }

      const goVersions = this.configStore.get("goVersions") || [];
      if (!goVersions.includes(version)) {
        goVersions.push(version);
        this.configStore.set("goVersions", goVersions);
      }

      if (goVersions.length === 1) {
        await this.setActive(version);
      }

      return { success: true, message: `Go ${version} 安装成功` };
    } catch (error: any) {
      return { success: false, message: `安装失败: ${error.message}` };
    }
  }

  /**
   * 卸载 Go 版本
   */
  async uninstall(
    version: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const goPath = this.configStore.getGoPath();
      const versionDir = join(goPath, `go-${version}`);

      if (!existsSync(versionDir)) {
        return { success: false, message: `Go ${version} 未安装` };
      }

      const activeVersion = this.configStore.get("activeGoVersion");
      if (activeVersion === version) {
        this.configStore.set("activeGoVersion", "");
        // 仅在卸载活动版本时清理其 PATH 条目，避免误伤其它已设为活动的 Go 版本。
        await this.removeFromPath(versionDir);
      }

      rmSync(versionDir, { recursive: true, force: true });

      const goVersions = this.configStore.get("goVersions") || [];
      const index = goVersions.indexOf(version);
      if (index > -1) {
        goVersions.splice(index, 1);
        this.configStore.set("goVersions", goVersions);
      }

      return { success: true, message: `Go ${version} 已卸载` };
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` };
    }
  }

  /**
   * 设置活动的 Go 版本
   */
  async setActive(
    version: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const goPath = this.configStore.getGoPath();
      const versionDir = join(goPath, `go-${version}`);

      if (!existsSync(join(versionDir, "bin", "go.exe"))) {
        return { success: false, message: `Go ${version} 未安装` };
      }

      await this.addToPath(versionDir);

      this.configStore.set("activeGoVersion", version);
      this.configStore.set("activeGoPath", "");

      return { success: true, message: `已将 Go ${version} 设为默认版本` };
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` };
    }
  }

  /**
   * 将系统已安装的 Go 设为默认。path 为 Go 安装根（含 bin/go.exe）。
   */
  async setActiveSystem(
    path: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const goRoot = path.trim();
      if (!goRoot || !existsSync(goRoot)) {
        return { success: false, message: `路径不存在: ${path}` };
      }
      if (!existsSync(join(goRoot, "bin", "go.exe"))) {
        return {
          success: false,
          message: `该目录下找不到 bin/go.exe，不是有效的 Go 安装: ${goRoot}`,
        };
      }

      let version = "system";
      try {
        const { stdout } = await execAsync(
          `"${join(goRoot, "bin", "go.exe")}" version`,
          { windowsHide: true, timeout: 8000 },
        );
        const m = stdout.match(/go version (go[\d.]+)/i);
        if (m) version = m[1].replace(/^go/, "");
      } catch {}

      const binPath = join(goRoot, "bin");
      const replacePrefix = this.configStore.getGoPath();
      const result = await this.pathManager.add([binPath], replacePrefix);
      if (!result.success) {
        return { success: false, message: `设置环境变量失败: ${result.message}` };
      }

      this.configStore.set("activeGoVersion", version);
      this.configStore.set("activeGoPath", goRoot);

      return {
        success: true,
        message: `系统 Go ${version} 已设为默认\n路径: ${goRoot}`,
      };
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` };
    }
  }

  /**
   * 卸载系统已安装的 Go（递归删除传入安装根目录）。⚠️ 不可逆，UI 需二次确认。
   * 安全校验：仅当目录含 bin/go.exe 才删除。
   */
  async uninstallSystem(
    path: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const goRoot = path.trim();
      if (!goRoot || !existsSync(goRoot)) {
        return { success: false, message: `路径不存在: ${path}` };
      }
      if (!existsSync(join(goRoot, "bin", "go.exe"))) {
        return {
          success: false,
          message: `该目录下找不到 bin/go.exe，拒绝删除以防误删: ${goRoot}`,
        };
      }

      const activePath = this.configStore.getActiveGoPath();
      if (
        activePath &&
        activePath.toLowerCase() === goRoot.toLowerCase() &&
        this.configStore.get("activeGoVersion")
      ) {
        await this.pathManager.remove(goRoot);
        this.configStore.set("activeGoVersion", "");
        this.configStore.set("activeGoPath", "");
      }

      rmSync(goRoot, { recursive: true, force: true });
      return { success: true, message: `系统 Go 已卸载: ${goRoot}` };
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` };
    }
  }

  /**
   * 获取 Go 信息
   */
  async getGoInfo(
    version: string,
  ): Promise<{ goVersion: string; path: string } | null> {
    const goPath = this.configStore.getGoPath();
    const versionDir = join(goPath, `go-${version}`);
    const goExe = join(versionDir, "bin", "go.exe");

    if (!existsSync(goExe)) return null;

    try {
      const { stdout } = await execAsync(`"${goExe}" version`, {
        timeout: 5000,
      });
      return {
        goVersion: stdout.trim(),
        path: versionDir,
      };
    } catch {
      return null;
    }
  }

  private async downloadFile(
    url: string,
    dest: string,
    name: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;

      const request = protocol.get(
        url,
        {
          headers: { "User-Agent": "PHPer-Dev-Manager/1.0" },
          timeout: 600000,
        },
        (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.downloadFile(redirectUrl, dest, name)
                .then(resolve)
                .catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(
            response.headers["content-length"] || "0",
            10,
          );
          let downloadedSize = 0;
          let lastProgressTime = 0;

          const file = createWriteStream(dest);

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            const now = Date.now();
            if (now - lastProgressTime > 500) {
              const progress =
                totalSize > 0
                  ? Math.round((downloadedSize / totalSize) * 100)
                  : 0;
              sendDownloadProgress("go", progress, downloadedSize, totalSize);
              lastProgressTime = now;
            }
          });

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            sendDownloadProgress("go", 100, totalSize, totalSize);
            resolve();
          });

          file.on("error", (err) => {
            unlinkSync(dest);
            reject(err);
          });
        },
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("Download timeout"));
      });
    });
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { createReadStream } = require("fs");
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on("close", resolve)
        .on("error", reject);
    });
  }

  private async addToPath(goPath: string): Promise<void> {
    const binPath = join(goPath, "bin");
    try {
      // 切换 Go 版本：按 …\go 前缀整体移除旧版本 PATH 后前置新版本 bin。
      const replacePrefix = this.configStore.getGoPath();
      const result = await this.pathManager.add([binPath], replacePrefix);
      if (!result.success) {
        console.error("更新 Go PATH 失败:", result.message);
      }
    } catch (error: any) {
      console.error("更新 Go PATH 失败:", error);
    }
  }

  private async removeFromPath(goPath: string): Promise<void> {
    try {
      // 卸载某 Go 版本：仅移除该版本目录下的 PATH 条目（精确前缀），不动活动版本。
      const result = await this.pathManager.remove(goPath);
      if (!result.success) {
        console.warn("移除 Go PATH 失败:", result.message);
      }
    } catch (error: any) {
      console.error("移除 Go PATH 失败:", error);
    }
  }

  private getFallbackVersions(): AvailableGoVersion[] {
    return [
      {
        version: "go1.25.7",
        stable: true,
        downloadUrl: "https://go.dev/dl/go1.25.7.windows-amd64.zip",
        filename: "go1.25.7.windows-amd64.zip",
      },
      {
        version: "go1.24.13",
        stable: true,
        downloadUrl: "https://go.dev/dl/go1.24.13.windows-amd64.zip",
        filename: "go1.24.13.windows-amd64.zip",
      },
      {
        version: "go1.23.5",
        stable: true,
        downloadUrl: "https://go.dev/dl/go1.23.5.windows-amd64.zip",
        filename: "go1.23.5.windows-amd64.zip",
      },
      {
        version: "go1.22.14",
        stable: true,
        downloadUrl: "https://go.dev/dl/go1.22.14.windows-amd64.zip",
        filename: "go1.22.14.windows-amd64.zip",
      },
    ];
  }
}
