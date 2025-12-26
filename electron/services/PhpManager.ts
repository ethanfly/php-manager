import { ConfigStore } from "./ConfigStore";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import https from "https";
import http from "http";
import { createWriteStream } from "fs";
import { sendDownloadProgress } from "../main";

const execAsync = promisify(exec);

interface PhpVersion {
  version: string;
  path: string;
  isActive: boolean;
}

interface PhpExtension {
  name: string;
  enabled: boolean;
  installed: boolean;
}

interface AvailablePeclExtension {
  name: string;
  version: string;
  downloadUrl: string;
  description?: string;
  packageName?: string; // Packagist 包名，用于 PIE 安装
}

interface AvailablePhpVersion {
  version: string;
  downloadUrl: string;
  type: "nts" | "ts";
  arch: "x64" | "x86";
}

export class PhpManager {
  private configStore: ConfigStore;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
  }

  /**
   * 获取已安装的 PHP 版本列表
   */
  async getInstalledVersions(): Promise<PhpVersion[]> {
    const versions: PhpVersion[] = [];
    const activeVersion = this.configStore.get("activePhpVersion");
    const phpDir = join(this.configStore.getBasePath(), "php");

    if (!existsSync(phpDir)) {
      return versions;
    }

    const dirs = readdirSync(phpDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory() && dir.name.startsWith("php-")) {
        const version = dir.name.replace("php-", "");
        const phpPath = join(phpDir, dir.name);

        // 验证 PHP 是否真的存在
        if (existsSync(join(phpPath, "php.exe"))) {
          versions.push({
            version,
            path: phpPath,
            isActive: version === activeVersion,
          });
        }
      }
    }

    return versions.sort((a, b) => b.version.localeCompare(a.version));
  }

  /**
   * 从 windows.php.net 自动获取可用的 PHP 版本列表
   */
  async getAvailableVersions(): Promise<AvailablePhpVersion[]> {
    let versions: AvailablePhpVersion[] = [];

    try {
      // 尝试从 windows.php.net/downloads/releases/ 获取版本列表
      versions = await this.fetchPhpVersionsFromWeb();
    } catch (error) {
      console.error("获取 PHP 版本列表失败:", error);
    }

    // 如果网络获取失败或为空，使用备用列表
    if (versions.length === 0) {
      console.log("使用备用版本列表");
      versions = this.getFallbackVersions();
    }

    // 过滤掉已安装的版本
    const installed = await this.getInstalledVersions();
    const installedVersions = installed.map((v) => v.version);

    return versions.filter((v) => !installedVersions.includes(v.version));
  }

  /**
   * 从网页获取 PHP 版本列表
   */
  private async fetchPhpVersionsFromWeb(): Promise<AvailablePhpVersion[]> {
    return new Promise((resolve, reject) => {
      const url = "https://windows.php.net/downloads/releases/";

      https
        .get(
          url,
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          },
          (response) => {
            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }

            let html = "";
            response.on("data", (chunk) => (html += chunk));
            response.on("end", () => {
              try {
                const versions = this.parsePhpVersionsFromHtml(html);
                resolve(versions);
              } catch (e) {
                reject(e);
              }
            });
          }
        )
        .on("error", reject)
        .setTimeout(10000, () => {
          reject(new Error("请求超时"));
        });
    });
  }

  /**
   * 解析 HTML 获取 PHP 版本信息
   */
  private parsePhpVersionsFromHtml(html: string): AvailablePhpVersion[] {
    const versions: AvailablePhpVersion[] = [];
    const seenVersions = new Set<string>();

    // 多种正则模式匹配不同格式
    const patterns = [
      // 标准格式: php-8.4.3-nts-Win32-vs17-x64.zip
      /php-(\d+\.\d+\.\d+)-nts-Win32-vs(\d+)-x64\.zip/g,
      // TS格式: php-8.4.3-Win32-vs17-x64.zip
      /php-(\d+\.\d+\.\d+)-Win32-vs(\d+)-x64\.zip/g,
    ];

    // 匹配 NTS 版本
    let match;
    const ntsRegex = /php-(\d+\.\d+\.\d+)-nts-Win32-vs(\d+)-x64\.zip/g;
    while ((match = ntsRegex.exec(html)) !== null) {
      const version = match[1];
      const vsVersion = match[2];
      const versionKey = `${version}-nts`;

      if (!seenVersions.has(versionKey)) {
        seenVersions.add(versionKey);
        versions.push({
          version: version,
          downloadUrl: `https://windows.php.net/downloads/releases/php-${version}-nts-Win32-vs${vsVersion}-x64.zip`,
          type: "nts",
          arch: "x64",
        });
      }
    }

    // 匹配 TS 版本 (不含 nts 的)
    const tsRegex = /php-(\d+\.\d+\.\d+)-Win32-vs(\d+)-x64\.zip/g;
    while ((match = tsRegex.exec(html)) !== null) {
      const fullMatch = match[0];
      // 跳过 nts 版本（已经处理过）
      if (fullMatch.includes("-nts-")) continue;

      const version = match[1];
      const vsVersion = match[2];
      const versionKey = `${version}-ts`;

      if (!seenVersions.has(versionKey)) {
        seenVersions.add(versionKey);
        versions.push({
          version: `${version}-ts`,
          downloadUrl: `https://windows.php.net/downloads/releases/php-${version}-Win32-vs${vsVersion}-x64.zip`,
          type: "ts",
          arch: "x64",
        });
      }
    }

    // 按版本号排序（降序）
    versions.sort((a, b) => {
      const vA = a.version.replace("-ts", "");
      const vB = b.version.replace("-ts", "");
      return vB.localeCompare(vA, undefined, { numeric: true });
    });

    console.log(`从 windows.php.net 获取到 ${versions.length} 个 PHP 版本`);
    if (versions.length > 0) {
      console.log("版本列表:", versions.map((v) => v.version).join(", "));
    }
    return versions;
  }

  /**
   * 备用版本列表（当网络请求失败时使用）
   * 基于 https://windows.php.net/download/ (2025-12-25)
   */
  private getFallbackVersions(): AvailablePhpVersion[] {
    return [
      // PHP 8.4 (VS17) - 最新稳定版
      {
        version: "8.4.3",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.4.3-nts-Win32-vs17-x64.zip",
        type: "nts",
        arch: "x64",
      },
      {
        version: "8.4.3-ts",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.4.3-Win32-vs17-x64.zip",
        type: "ts",
        arch: "x64",
      },

      // PHP 8.3 (VS16)
      {
        version: "8.3.15",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.3.15-nts-Win32-vs16-x64.zip",
        type: "nts",
        arch: "x64",
      },
      {
        version: "8.3.15-ts",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.3.15-Win32-vs16-x64.zip",
        type: "ts",
        arch: "x64",
      },

      // PHP 8.2 (VS16)
      {
        version: "8.2.27",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.2.27-nts-Win32-vs16-x64.zip",
        type: "nts",
        arch: "x64",
      },
      {
        version: "8.2.27-ts",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.2.27-Win32-vs16-x64.zip",
        type: "ts",
        arch: "x64",
      },

      // PHP 8.1 (VS16)
      {
        version: "8.1.31",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.1.31-nts-Win32-vs16-x64.zip",
        type: "nts",
        arch: "x64",
      },
      {
        version: "8.1.31-ts",
        downloadUrl:
          "https://windows.php.net/downloads/releases/php-8.1.31-Win32-vs16-x64.zip",
        type: "ts",
        arch: "x64",
      },
    ];
  }

  /**
   * 安装 PHP 版本
   */
  async install(
    version: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions();
      const versionInfo = available.find((v) => v.version === version);

      if (!versionInfo) {
        return { success: false, message: `未找到 PHP ${version} 版本` };
      }

      const phpPath = this.configStore.getPhpPath(version);
      const tempPath = this.configStore.getTempPath();
      const zipPath = join(tempPath, `php-${version}.zip`);

      // 确保目录存在
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true });
      }
      if (!existsSync(phpPath)) {
        mkdirSync(phpPath, { recursive: true });
      }

      console.log(`开始下载 PHP ${version} 从 ${versionInfo.downloadUrl}`);

      // 下载 PHP
      await this.downloadFile(versionInfo.downloadUrl, zipPath);

      console.log(`下载完成，开始解压到 ${phpPath}`);

      // 解压
      await this.unzip(zipPath, phpPath);

      console.log("解压完成");

      // 删除临时文件
      if (existsSync(zipPath)) {
        unlinkSync(zipPath);
      }

      // 创建默认 php.ini
      await this.createDefaultPhpIni(phpPath);

      // 添加到配置
      this.configStore.addPhpVersion(version);

      return { success: true, message: `PHP ${version} 安装成功` };
    } catch (error: any) {
      console.error("PHP 安装失败:", error);
      return { success: false, message: `安装失败: ${error.message}` };
    }
  }

  /**
   * 卸载 PHP 版本
   */
  async uninstall(
    version: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);

      if (!existsSync(phpPath)) {
        return { success: false, message: `PHP ${version} 未安装` };
      }

      // 如果是当前活动版本，先清除环境变量
      const activeVersion = this.configStore.get("activePhpVersion");
      if (activeVersion === version) {
        await this.removeFromPath(phpPath);
        this.configStore.set("activePhpVersion", "");
      }

      // 递归删除目录
      this.removeDirectory(phpPath);

      // 从配置中移除
      this.configStore.removePhpVersion(version);

      return { success: true, message: `PHP ${version} 已卸载` };
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` };
    }
  }

  /**
   * 设置活动的 PHP 版本（添加到环境变量）
   */
  async setActive(
    version: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);

      if (!existsSync(phpPath)) {
        return { success: false, message: `PHP ${version} 未安装` };
      }

      // 检查 php.exe 是否存在
      if (!existsSync(join(phpPath, "php.exe"))) {
        return {
          success: false,
          message: `PHP ${version} 安装不完整，找不到 php.exe`,
        };
      }

      console.log(`设置 PHP ${version} 为默认版本，路径: ${phpPath}`);

      // 添加新的 PHP 路径到环境变量（会自动移除旧的 PHP 路径）
      await this.addToPath(phpPath);

      // 更新配置
      this.configStore.set("activePhpVersion", version);

      return {
        success: true,
        message: `PHP ${version} 已设置为默认版本\n\n环境变量已更新，新开的终端窗口中将生效。\n路径: ${phpPath}`,
      };
    } catch (error: any) {
      console.error("设置默认 PHP 版本失败:", error);
      return { success: false, message: `设置失败: ${error.message}` };
    }
  }

  /**
   * 打开扩展目录（用于手动安装扩展）
   */
  async openExtensionDir(
    version: string
  ): Promise<{ success: boolean; message: string; path?: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);
      const extDir = join(phpPath, "ext");

      if (!existsSync(extDir)) {
        mkdirSync(extDir, { recursive: true });
      }

      // 使用 Electron shell 打开文件夹（更可靠）
      const { shell } = await import("electron");
      const result = await shell.openPath(extDir);

      if (result) {
        // result 非空表示有错误
        return { success: false, message: `打开失败: ${result}` };
      }

      return {
        success: true,
        message: `已打开扩展目录: ${extDir}`,
        path: extDir,
      };
    } catch (error: any) {
      return { success: false, message: `打开失败: ${error.message}` };
    }
  }

  /**
   * 获取 PHP 扩展列表
   */
  async getExtensions(version: string): Promise<PhpExtension[]> {
    const phpPath = this.configStore.getPhpPath(version);
    const extDir = join(phpPath, "ext");
    const iniPath = join(phpPath, "php.ini");

    if (!existsSync(extDir)) {
      return [];
    }

    const extensions: PhpExtension[] = [];
    const iniContent = existsSync(iniPath)
      ? readFileSync(iniPath, "utf-8")
      : "";

    // 将 ini 内容按行分割，用于精确匹配
    const iniLines = iniContent.split("\n");

    const files = readdirSync(extDir);
    for (const file of files) {
      if (file.startsWith("php_") && file.endsWith(".dll")) {
        const extName = file.replace("php_", "").replace(".dll", "");

        // 检查是否有未被注释的 extension= 行
        const isEnabled = iniLines.some((line) => {
          const trimmedLine = line.trim();
          // 跳过注释行
          if (trimmedLine.startsWith(";")) {
            return false;
          }
          // 检查各种可能的格式
          return (
            trimmedLine === `extension=${extName}` ||
            trimmedLine === `extension=php_${extName}.dll` ||
            trimmedLine === `extension=${extName}.dll` ||
            trimmedLine.startsWith(`extension=${extName} `) ||
            trimmedLine.startsWith(`extension=php_${extName}.dll `) ||
            trimmedLine.startsWith(`extension=${extName}.dll `)
          );
        });

        extensions.push({
          name: extName,
          enabled: isEnabled,
          installed: true,
        });
      }
    }

    return extensions.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 启用扩展
   */
  async enableExtension(
    version: string,
    ext: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);
      const iniPath = join(phpPath, "php.ini");

      if (!existsSync(iniPath)) {
        return { success: false, message: "php.ini 文件不存在" };
      }

      let content = readFileSync(iniPath, "utf-8");
      const lines = content.split("\n");
      let found = false;
      let alreadyEnabled = false;

      // 扩展可能的格式
      const patterns = [
        new RegExp(`^;?\\s*extension\\s*=\\s*${ext}\\s*$`, "i"),
        new RegExp(`^;?\\s*extension\\s*=\\s*php_${ext}\\.dll\\s*$`, "i"),
        new RegExp(`^;?\\s*extension\\s*=\\s*${ext}\\.dll\\s*$`, "i"),
      ];

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of patterns) {
          if (pattern.test(lines[i])) {
            found = true;
            if (lines[i].trim().startsWith(";")) {
              // 取消注释
              lines[i] = lines[i].replace(/^(\s*);/, "$1");
            } else {
              alreadyEnabled = true;
            }
            break;
          }
        }
      }

      if (alreadyEnabled) {
        return { success: true, message: `扩展 ${ext} 已经启用` };
      }

      if (!found) {
        // 添加新的扩展配置
        // 查找 Dynamic Extensions 区域或文件末尾
        let insertIndex = lines.findIndex(
          (l) => l.includes("[PHP]") || l.includes("Dynamic Extensions")
        );
        if (insertIndex === -1) {
          insertIndex = lines.length;
        } else {
          // 在该区域后找到合适位置
          for (let i = insertIndex + 1; i < lines.length; i++) {
            if (lines[i].startsWith("[") && !lines[i].includes("Dynamic")) {
              insertIndex = i;
              break;
            }
            if (lines[i].includes("extension=")) {
              insertIndex = i + 1;
            }
          }
        }
        lines.splice(insertIndex, 0, `extension=${ext}`);
      }

      writeFileSync(iniPath, lines.join("\n"));
      return { success: true, message: `扩展 ${ext} 已启用，重启 PHP 后生效` };
    } catch (error: any) {
      return { success: false, message: `启用扩展失败: ${error.message}` };
    }
  }

  /**
   * 禁用扩展
   */
  async disableExtension(
    version: string,
    ext: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);
      const iniPath = join(phpPath, "php.ini");

      if (!existsSync(iniPath)) {
        return { success: false, message: "php.ini 文件不存在" };
      }

      let content = readFileSync(iniPath, "utf-8");
      const lines = content.split("\n");
      let found = false;

      // 扩展可能的格式
      const patterns = [
        new RegExp(`^\\s*extension\\s*=\\s*${ext}\\s*$`, "i"),
        new RegExp(`^\\s*extension\\s*=\\s*php_${ext}\\.dll\\s*$`, "i"),
        new RegExp(`^\\s*extension\\s*=\\s*${ext}\\.dll\\s*$`, "i"),
      ];

      for (let i = 0; i < lines.length; i++) {
        for (const pattern of patterns) {
          if (pattern.test(lines[i])) {
            found = true;
            if (!lines[i].trim().startsWith(";")) {
              // 注释掉
              lines[i] = ";" + lines[i];
            }
            break;
          }
        }
      }

      if (!found) {
        return { success: true, message: `扩展 ${ext} 未找到或已禁用` };
      }

      writeFileSync(iniPath, lines.join("\n"));
      return { success: true, message: `扩展 ${ext} 已禁用，重启 PHP 后生效` };
    } catch (error: any) {
      return { success: false, message: `禁用扩展失败: ${error.message}` };
    }
  }

  /**
   * 获取可安装的 PECL 扩展列表（从 pecl.php.net 搜索）
   */
  async getAvailableExtensions(
    version: string,
    searchKeyword?: string
  ): Promise<AvailablePeclExtension[]> {
    const extensions: AvailablePeclExtension[] = [];

    try {
      // 获取 PHP 版本信息
      const phpPath = this.configStore.getPhpPath(version);
      const phpInfo = await this.getPhpInfo(phpPath);

      if (!phpInfo) {
        console.error("无法获取 PHP 信息");
        return this.getDefaultExtensionList(version);
      }

      const { majorMinor, isNts } = phpInfo;
      console.log(`PHP Info: ${majorMinor}, NTS: ${isNts}`);

      // 使用 Packagist API 获取扩展列表（PIE 推荐方式）
      // https://packagist.org/extensions
      const keyword = searchKeyword || "";
      const searchUrl = keyword
        ? `https://packagist.org/search.json?q=${encodeURIComponent(
            keyword
          )}&type=php-ext`
        : `https://packagist.org/search.json?type=php-ext`;

      console.log(`从 Packagist 搜索扩展: ${keyword || "(全部)"}`);

      let foundPackages: {
        name: string;
        description: string;
        packageName: string;
      }[] = [];

      try {
        const jsonStr = await this.fetchHtmlContent(searchUrl);
        const data = JSON.parse(jsonStr);

        if (data.results && Array.isArray(data.results)) {
          for (const pkg of data.results) {
            // Packagist 包名格式：vendor/package
            const packageName = pkg.name || "";
            // 扩展名通常是包名的最后一部分，或从 description 提取
            let extName = packageName.split("/").pop() || "";
            // 移除常见前缀
            extName = extName
              .replace(/^php[-_]?/, "")
              .replace(/[-_]?extension$/, "");

            foundPackages.push({
              name: extName,
              description: pkg.description || "",
              packageName: packageName,
            });
          }
        }
        console.log(`从 Packagist 找到 ${foundPackages.length} 个扩展包`);
      } catch (e: any) {
        console.log(`Packagist API 请求失败: ${e.message}，尝试使用预定义列表`);
      }

      // 如果 Packagist 无结果，使用预定义的常用扩展列表
      if (foundPackages.length === 0) {
        foundPackages = this.getPopularExtensionsList(keyword);
        console.log(`使用预定义扩展列表: ${foundPackages.length} 个`);
      }

      // 获取已安装的扩展
      const installedExts = await this.getExtensions(version);
      const installedNames = installedExts.map((e) => e.name.toLowerCase());

      // 过滤已安装的扩展
      const availablePackages = foundPackages.filter(
        (pkg) => !installedNames.includes(pkg.name.toLowerCase())
      );

      // 限制数量
      const checkPackages = availablePackages.slice(0, searchKeyword ? 50 : 20);

      for (const pkg of checkPackages) {
        extensions.push({
          name: pkg.name,
          version: "latest",
          downloadUrl: "", // PIE 会自动处理
          description: pkg.description,
          packageName: pkg.packageName,
        } as AvailablePeclExtension & { packageName?: string });
      }

      console.log(`找到 ${extensions.length} 个可安装的扩展`);
      return extensions.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: any) {
      console.error("获取可用扩展列表失败:", error);
      return this.getDefaultExtensionList(version);
    }
  }

  /**
   * 获取常用 PHP 扩展列表（带 Packagist 包名）
   * PIE 包名格式参考: https://packagist.org/extensions
   */
  private getPopularExtensionsList(
    keyword?: string
  ): { name: string; description: string; packageName: string }[] {
    // PIE 兼容的扩展包名（vendor/package 格式）
    const popularExtensions = [
      {
        name: "redis",
        description: "PHP extension for Redis",
        packageName: "phpredis/phpredis", // 正确的 PIE 包名
      },
      {
        name: "mongodb",
        description: "MongoDB driver for PHP",
        packageName: "mongodb/mongodb", // MongoDB 官方扩展
      },
      {
        name: "memcached",
        description: "PHP extension for Memcached",
        packageName: "php-memcached-dev/php-memcached",
      },
      {
        name: "imagick",
        description: "ImageMagick for PHP",
        packageName: "imagick/imagick",
      },
      {
        name: "xdebug",
        description: "Debugging and profiling for PHP",
        packageName: "xdebug/xdebug",
      },
      {
        name: "swoole",
        description: "High-performance coroutine framework",
        packageName: "openswoole/swoole", // OpenSwoole（PIE 兼容）
      },
      {
        name: "yaml",
        description: "YAML parser and emitter",
        packageName: "php/pecl-file_formats-yaml",
      },
      {
        name: "apcu",
        description: "APCu - APC User Cache",
        packageName: "apcu/apcu", // 正确的 PIE 包名
      },
      { name: "grpc", description: "gRPC for PHP", packageName: "grpc/grpc" },
      {
        name: "protobuf",
        description: "Protocol Buffers",
        packageName: "google/protobuf",
      },
      {
        name: "igbinary",
        description: "Binary serialization",
        packageName: "igbinary/igbinary",
      },
      {
        name: "msgpack",
        description: "MessagePack serialization",
        packageName: "msgpack/msgpack-php",
      },
      {
        name: "sodium",
        description: "Modern cryptography library",
        packageName: "php/pecl-crypto-sodium",
      },
      {
        name: "zip",
        description: "ZIP file support",
        packageName: "php/pecl-file_formats-zip",
      },
      {
        name: "rar",
        description: "RAR archive support",
        packageName: "php/pecl-file_formats-rar",
      },
      {
        name: "amqp",
        description: "AMQP messaging library",
        packageName: "php-amqp/php-amqp",
      },
      {
        name: "oauth",
        description: "OAuth consumer extension",
        packageName: "php/pecl-web_services-oauth",
      },
      {
        name: "ssh2",
        description: "SSH2 bindings",
        packageName: "php/pecl-networking-ssh2",
      },
      {
        name: "event",
        description: "Event-based I/O",
        packageName: "php/pecl-event",
      },
      {
        name: "uv",
        description: "libuv bindings",
        packageName: "amphp/ext-uv",
      },
    ];

    if (!keyword) {
      return popularExtensions;
    }

    const lowerKeyword = keyword.toLowerCase();
    return popularExtensions.filter(
      (ext) =>
        ext.name.toLowerCase().includes(lowerKeyword) ||
        ext.description.toLowerCase().includes(lowerKeyword) ||
        ext.packageName.toLowerCase().includes(lowerKeyword)
    );
  }

  /**
   * 解码 HTML 实体
   */
  private decodeHtmlEntities(html: string): string {
    return html
      .replace(/&period;/g, ".")
      .replace(/&sol;/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) =>
        String.fromCharCode(parseInt(code, 10))
      )
      .replace(/&nbsp;/g, " ");
  }

  /**
   * 从 PECL 详情页获取扩展信息
   * 流程：
   * 1. 访问 https://pecl.php.net/package/扩展名 获取最新稳定版本
   * 2. 访问 https://pecl.php.net/package/扩展名/版本/windows 获取 Windows DLL 链接
   */
  private async getExtensionFromPecl(
    extName: string,
    phpInfo: { majorMinor: string; isNts: boolean; compiler: string }
  ): Promise<AvailablePeclExtension | null> {
    const { majorMinor, isNts } = phpInfo;

    try {
      // 1. 获取扩展详情页，找到最新稳定版本
      const packageUrl = `https://pecl.php.net/package/${extName}`;
      console.log(`获取扩展详情: ${packageUrl}`);
      let packageHtml = await this.fetchHtmlContent(packageUrl);

      console.log(`获取到 HTML 长度: ${packageHtml.length}`);
      if (packageHtml.length < 1000) {
        console.log(
          `HTML 内容过短，可能获取失败: ${packageHtml.substring(0, 500)}`
        );
      }

      // 解码 HTML 实体（如 &period; -> . , &sol; -> /）
      packageHtml = this.decodeHtmlEntities(packageHtml);
      console.log(`解码后 HTML 长度: ${packageHtml.length}`);

      // 解析版本列表，找到最新的稳定版本（state=stable 且有 DLL 链接）
      // 分步解析：
      // 1. 找到所有表格行 <tr>...</tr>
      // 2. 检查每行是否包含 DLL 链接和版本信息

      let latestStableVersion: string | null = null;
      let latestBetaVersion: string | null = null;

      // 方法1：直接搜索带 DLL 链接的版本
      // 格式: /package/xxx/VERSION/windows">...DLL
      const dllVersionRegex = /\/package\/[^/]+\/([\d.]+(?:RC\d+)?)\/windows/gi;
      const versionsWithDll: string[] = [];
      let dllMatch;

      // 调试：打印部分 HTML 内容查看格式
      const windowsLinkIndex = packageHtml.indexOf("/windows");
      if (windowsLinkIndex > 0) {
        console.log(
          `HTML 样本 (解码后): ${packageHtml.substring(
            Math.max(0, windowsLinkIndex - 100),
            windowsLinkIndex + 50
          )}`
        );
      } else {
        // 可能解码不完整，检查是否还有编码的 windows
        console.log("解码后未找到 /windows，检查原始 HTML...");
        // 尝试多种可能的编码形式
        const patterns = ['windows"', "windows<", "DLL</a>", "/windows"];
        for (const pattern of patterns) {
          const idx = packageHtml.indexOf(pattern);
          if (idx > 0) {
            console.log(
              `找到 "${pattern}" 在位置 ${idx}: ${packageHtml.substring(
                Math.max(0, idx - 80),
                idx + 40
              )}`
            );
            break;
          }
        }
      }

      while ((dllMatch = dllVersionRegex.exec(packageHtml)) !== null) {
        const ver = dllMatch[1];
        if (!versionsWithDll.includes(ver)) {
          versionsWithDll.push(ver);
          console.log(`找到带 DLL 的版本: ${ver}`);
        }
      }

      // 对每个有 DLL 的版本，检查其状态
      for (const ver of versionsWithDll) {
        // 在 HTML 中找到这个版本对应的行，检查是 stable 还是 beta
        // 格式: >VERSION</a>...stable 或 >VERSION</a>...beta
        const stateRegex = new RegExp(
          `>${ver.replace(
            /\./g,
            "\\."
          )}</a>[\\s\\S]*?<td[^>]*>\\s*(stable|beta|alpha)\\s*</td>`,
          "i"
        );
        const stateMatch = stateRegex.exec(packageHtml);

        if (stateMatch) {
          const state = stateMatch[1].toLowerCase();
          console.log(`版本 ${ver} 状态: ${state}`);

          if (state === "stable" && !latestStableVersion) {
            latestStableVersion = ver;
            break; // 找到第一个稳定版本就停止
          } else if (
            (state === "beta" || state === "alpha") &&
            !latestBetaVersion
          ) {
            latestBetaVersion = ver;
          }
        }
      }

      let targetVersion = latestStableVersion || latestBetaVersion;

      // 如果正则匹配失败，直接使用第一个有 DLL 的版本
      if (!targetVersion && versionsWithDll.length > 0) {
        targetVersion = versionsWithDll[0];
        console.log(`未能确定状态，使用第一个有 DLL 的版本: ${targetVersion}`);
      }

      if (!targetVersion) {
        console.log(`扩展 ${extName} 没有 Windows DLL`);
        return null;
      }

      console.log(`扩展 ${extName} 最新版本: ${targetVersion}`);

      // 2. 获取 Windows DLL 页面
      const windowsUrl = `https://pecl.php.net/package/${extName}/${targetVersion}/windows`;
      console.log(`获取 Windows DLL 列表: ${windowsUrl}`);
      const windowsHtml = await this.fetchHtmlContent(windowsUrl);

      // 3. 查找匹配当前 PHP 版本的 DLL 链接
      // 实际 URL 格式：https://downloads.php.net/~windows/pecl/releases/redis/6.3.0/php_redis-6.3.0-8.3-nts-vs16-x64.zip
      // 注意：URL 中的下划线可能被编码为 %5F，如 php%5Fredis
      // 链接文本有换行和大量空格

      const tsType = isNts ? "nts" : "ts";

      // 提取所有 pecl releases 的 zip 链接
      const allLinksRegex =
        /<a\s+href="(https?:\/\/[^"]*pecl\/releases\/[^"]*\.zip)"/gi;
      const allLinks: string[] = [];
      let linkMatch;
      while ((linkMatch = allLinksRegex.exec(windowsHtml)) !== null) {
        allLinks.push(linkMatch[1]);
      }

      console.log(`找到 ${allLinks.length} 个 PECL DLL 链接`);

      // 解码 URL 并查找匹配的版本
      // 优先级：x64 > x86
      let matchedUrl: string | null = null;

      for (const url of allLinks) {
        // 解码 URL（%5F -> _）
        const decodedUrl = decodeURIComponent(url).toLowerCase();

        // 检查是否匹配 PHP 版本和 NTS/TS
        // 格式: -8.3-nts- 或 -8.3-ts-
        const versionPattern = `-${majorMinor}-${tsType}-`;

        if (decodedUrl.includes(versionPattern)) {
          // 优先选择 x64
          if (decodedUrl.includes("x64")) {
            matchedUrl = url;
            console.log(`匹配到 x64: ${url}`);
            break;
          } else if (!matchedUrl && decodedUrl.includes("x86")) {
            matchedUrl = url;
            console.log(`匹配到 x86: ${url}`);
            // 继续查找，看有没有 x64
          }
        }
      }

      if (matchedUrl) {
        console.log(`找到 ${extName} ${targetVersion} 的 DLL: ${matchedUrl}`);

        return {
          name: extName,
          version: targetVersion,
          downloadUrl: matchedUrl,
          description: await this.getExtensionDescription(extName),
        };
      }

      console.log(
        `扩展 ${extName} 没有适用于 PHP ${majorMinor} ${
          isNts ? "NTS" : "TS"
        } 的 DLL`
      );
      console.log(`可用链接: ${allLinks.slice(0, 5).join(", ")}...`);
      return null;
    } catch (error: any) {
      console.error(`获取扩展 ${extName} 失败:`, error.message);
      return null;
    }
  }

  /**
   * 从 windows.php.net 获取扩展列表（备用方法）
   */
  private async getExtensionsFromWindowsPhp(
    version: string,
    phpInfo: { majorMinor: string; isNts: boolean; compiler: string },
    searchKeyword?: string
  ): Promise<AvailablePeclExtension[]> {
    const extensions: AvailablePeclExtension[] = [];
    const { majorMinor, isNts, compiler } = phpInfo;

    try {
      const peclUrl = "https://windows.php.net/downloads/pecl/releases/";
      const html = await this.fetchHtmlContent(peclUrl);

      // 解析扩展目录
      const extDirRegex = /<a href="([a-zA-Z0-9_-]+)\/">/g;
      let match;
      const extNames: string[] = [];

      while ((match = extDirRegex.exec(html)) !== null) {
        const extName = match[1];
        if (extName && !extName.startsWith(".") && extName !== "snaps") {
          extNames.push(extName);
        }
      }

      // 获取已安装的扩展
      const installedExts = await this.getExtensions(version);
      const installedNames = installedExts.map((e) => e.name.toLowerCase());

      // 过滤搜索关键词
      let filteredNames = extNames;
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        filteredNames = extNames.filter((name) =>
          name.toLowerCase().includes(keyword)
        );
      }

      // 限制检查数量
      const checkNames = filteredNames.slice(0, searchKeyword ? 100 : 30);

      for (const extName of checkNames) {
        if (installedNames.includes(extName.toLowerCase())) continue;

        try {
          const extUrl = `${peclUrl}${extName}/`;
          const extHtml = await this.fetchHtmlContent(extUrl);

          const versionDirRegex = /<a href="([\d.]+)\/">/g;
          const versions: string[] = [];
          let vMatch;

          while ((vMatch = versionDirRegex.exec(extHtml)) !== null) {
            versions.push(vMatch[1]);
          }

          if (versions.length > 0) {
            versions.sort((a, b) =>
              b.localeCompare(a, undefined, { numeric: true })
            );
            const latestVersion = versions[0];

            const tsType = isNts ? "nts" : "ts";
            const dllPattern = `php_${extName}-${latestVersion}-${majorMinor}-${tsType}-${compiler}-x64.zip`;
            const dllUrl = `${extUrl}${latestVersion}/${dllPattern}`;

            const exists = await this.checkUrlExists(dllUrl);

            if (exists) {
              extensions.push({
                name: extName,
                version: latestVersion,
                downloadUrl: dllUrl,
              });
            }
          }
        } catch (e) {
          continue;
        }
      }

      return extensions.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error("从 windows.php.net 获取扩展失败:", error);
      return this.getDefaultExtensionList(version);
    }
  }

  /**
   * 获取扩展描述（简化版）
   */
  private async getExtensionDescription(
    extName: string
  ): Promise<string | undefined> {
    const descriptions: Record<string, string> = {
      redis: "PHP Redis 客户端扩展",
      memcached: "Memcached 缓存客户端",
      mongodb: "MongoDB 数据库驱动",
      imagick: "ImageMagick 图像处理",
      xdebug: "调试和性能分析工具",
      apcu: "用户数据缓存",
      yaml: "YAML 数据格式支持",
      swoole: "高性能异步网络框架",
      igbinary: "高效二进制序列化",
      ssh2: "SSH2 协议支持",
      grpc: "gRPC 远程调用支持",
      protobuf: "Protocol Buffers 支持",
      rar: "RAR 压缩文件支持",
      zip: "ZIP 压缩文件支持",
      oauth: "OAuth 认证支持",
      mailparse: "邮件解析扩展",
      uuid: "UUID 生成支持",
      xlswriter: "Excel 文件写入",
      event: "事件驱动扩展",
      ev: "libev 事件循环",
    };
    return descriptions[extName.toLowerCase()];
  }

  /**
   * 构建 PECL DLL 直接下载链接
   */
  private async buildPeclDownloadUrl(
    extName: string,
    phpInfo: { majorMinor: string; isNts: boolean; compiler: string }
  ): Promise<string | null> {
    const { majorMinor, isNts, compiler } = phpInfo;
    const tsType = isNts ? "nts" : "ts";

    // 常用扩展的 PECL 包名映射
    const extNameMapping: { [key: string]: string } = {
      redis: "redis",
      mongodb: "mongodb",
      memcached: "memcached",
      imagick: "imagick",
      xdebug: "xdebug",
      swoole: "swoole",
      yaml: "yaml",
      apcu: "apcu",
      igbinary: "igbinary",
      msgpack: "msgpack",
      grpc: "grpc",
      protobuf: "protobuf",
      amqp: "amqp",
      ssh2: "ssh2",
      event: "event",
      oauth: "oauth",
      rar: "rar",
      zip: "zip",
    };

    const peclExtName =
      extNameMapping[extName.toLowerCase()] || extName.toLowerCase();

    try {
      // 先获取最新版本
      const packageUrl = `https://pecl.php.net/package/${peclExtName}`;
      console.log(`从 PECL 获取 ${peclExtName} 版本列表: ${packageUrl}`);
      let html = await this.fetchHtmlContent(packageUrl);

      console.log(`获取到 HTML 长度: ${html.length}`);

      // 解码 HTML 实体
      html = this.decodeHtmlEntities(html);

      // 查找有 DLL 的版本 - 格式: /package/redis/6.3.0/windows
      const dllVersionRegex = /\/package\/[^\/]+\/([\d.]+(?:RC\d+)?)\/windows/g;
      const matches = html.match(dllVersionRegex);

      console.log(`找到 DLL 链接: ${matches ? matches.length : 0} 个`);

      let latestVersion: string | null = null;
      if (matches && matches.length > 0) {
        // 从第一个匹配中提取版本号
        const versionMatch = matches[0].match(/\/([\d.]+(?:RC\d+)?)\/windows/);
        if (versionMatch) {
          latestVersion = versionMatch[1];
        }
      }

      if (!latestVersion) {
        console.log(`未找到 ${peclExtName} 的 Windows DLL 版本`);
        // 尝试直接用最新版本号
        const anyVersionMatch = html.match(/\/package\/[^\/]+\/([\d.]+)["'>]/);
        if (anyVersionMatch) {
          latestVersion = anyVersionMatch[1];
          console.log(`尝试使用版本: ${latestVersion}`);
        } else {
          return null;
        }
      }

      console.log(`找到 ${peclExtName} 版本: ${latestVersion}`);

      // 构建下载链接
      // 格式: https://downloads.php.net/~windows/pecl/releases/redis/6.3.0/php_redis-6.3.0-8.4-nts-vs17-x64.zip
      const possibleUrls = [
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-${compiler}-x64.zip`,
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-${compiler}-x86.zip`,
        // 备选格式（不同编译器版本）
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-vs16-x64.zip`,
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-vc15-x64.zip`,
      ];

      // 检查哪个 URL 有效
      for (const url of possibleUrls) {
        console.log(`检查 URL: ${url}`);
        const exists = await this.checkUrlExists(url);
        if (exists) {
          console.log(`找到有效的 PECL DLL: ${url}`);
          return url;
        }
      }

      // 如果精确匹配失败，尝试从 Windows 页面解析
      const windowsUrl = `https://pecl.php.net/package/${peclExtName}/${latestVersion}/windows`;
      console.log(`从 Windows 页面查找: ${windowsUrl}`);
      const windowsHtml = await this.fetchHtmlContent(windowsUrl);

      // 查找匹配的 DLL 链接
      const allLinksRegex =
        /<a\s+href="(https?:\/\/[^"]*pecl\/releases\/[^"]*\.zip)"/gi;
      const allLinks: string[] = [];
      let linkMatch;
      while ((linkMatch = allLinksRegex.exec(windowsHtml)) !== null) {
        allLinks.push(linkMatch[1]);
      }

      for (const url of allLinks) {
        const decodedUrl = decodeURIComponent(url).toLowerCase();
        const versionPattern = `-${majorMinor}-${tsType}-`;

        if (decodedUrl.includes(versionPattern)) {
          if (decodedUrl.includes("x64")) {
            console.log(`从页面找到匹配的 DLL: ${url}`);
            return url;
          }
        }
      }

      console.log(`未能为 ${peclExtName} 构建有效的 PECL 下载链接`);
      return null;
    } catch (error: any) {
      console.error(`构建 PECL 下载链接失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 获取 PHP 版本信息
   */
  private async getPhpInfo(
    phpPath: string
  ): Promise<{ majorMinor: string; isNts: boolean; compiler: string } | null> {
    try {
      const phpExe = join(phpPath, "php.exe");
      if (!existsSync(phpExe)) return null;

      const { stdout } = await execAsync(`"${phpExe}" -i`, {
        windowsHide: true,
        timeout: 10000,
      });

      // 解析 PHP 版本
      const versionMatch = stdout.match(/PHP Version => (\d+\.\d+)/);
      const majorMinor = versionMatch ? versionMatch[1] : "8.3";

      // 检查是否是 NTS
      const isNts = stdout.includes("Thread Safety => disabled");

      // 解析编译器版本
      const compilerMatch =
        stdout.match(/Compiler => MSVC(\d+)/) ||
        stdout.match(/Visual C\+\+ (\d{4})/);
      let compiler = "vc15"; // 默认值
      if (compilerMatch) {
        const msvcVersion = parseInt(compilerMatch[1]);
        if (msvcVersion >= 1930 || compilerMatch[1] === "2022") {
          compiler = "vs17";
        } else if (msvcVersion >= 1920 || compilerMatch[1] === "2019") {
          compiler = "vs16";
        } else if (msvcVersion >= 1910 || compilerMatch[1] === "2017") {
          compiler = "vc15";
        }
      }

      // 也从目录名获取信息
      const pathParts = phpPath.toLowerCase();
      if (pathParts.includes("vs17")) compiler = "vs17";
      else if (pathParts.includes("vs16")) compiler = "vs16";

      console.log(
        `PHP Info: ${majorMinor}, NTS: ${isNts}, Compiler: ${compiler}`
      );
      return { majorMinor, isNts, compiler };
    } catch (error) {
      console.error("获取 PHP 信息失败:", error);
      return null;
    }
  }

  /**
   * 获取默认扩展列表（当在线获取失败时使用）
   */
  private getDefaultExtensionList(version: string): AvailablePeclExtension[] {
    // 常用的 PECL 扩展
    const commonExtensions = [
      { name: "redis", description: "Redis 缓存扩展" },
      { name: "memcached", description: "Memcached 缓存扩展" },
      { name: "mongodb", description: "MongoDB 数据库扩展" },
      { name: "imagick", description: "图像处理扩展" },
      { name: "xdebug", description: "调试和分析扩展" },
      { name: "apcu", description: "APCu 用户缓存扩展" },
      { name: "yaml", description: "YAML 解析扩展" },
      { name: "swoole", description: "高性能网络框架扩展" },
      { name: "igbinary", description: "高效序列化扩展" },
      { name: "ssh2", description: "SSH2 连接扩展" },
    ];

    return commonExtensions.map((ext) => ({
      name: ext.name,
      version: "latest",
      downloadUrl: `https://windows.php.net/downloads/pecl/releases/${ext.name}/`,
      description: ext.description,
    }));
  }

  /**
   * 确保 PIE (PHP Installer for Extensions) 已安装
   * 优先使用 Windows 可执行文件版本（实验性），备用 phar 版本
   * 参考: https://github.com/php/pie/blob/1.4.x/docs/usage.md
   */
  private async ensurePieInstalled(): Promise<{
    path: string;
    isExe: boolean;
  } | null> {
    const pieDir = join(this.configStore.getBasePath(), "tools");
    const pieExePath = join(pieDir, "pie.exe");
    const piePharPath = join(pieDir, "pie.phar");

    // 优先检查 exe 版本
    if (existsSync(pieExePath)) {
      return { path: pieExePath, isExe: true };
    }

    // 检查 phar 版本
    if (existsSync(piePharPath)) {
      return { path: piePharPath, isExe: false };
    }

    // 下载 PIE
    console.log("正在下载 PIE (PHP Installer for Extensions)...");
    mkdirSync(pieDir, { recursive: true });

    // 尝试下载 Windows 可执行文件版本（实验性但更可靠）
    try {
      const pieExeUrl = "https://php.github.io/pie/pie-Windows-X64.exe";
      console.log(`尝试下载 PIE Windows 可执行文件: ${pieExeUrl}`);
      await this.downloadFile(pieExeUrl, pieExePath);
      console.log("PIE Windows 可执行文件下载完成");
      return { path: pieExePath, isExe: true };
    } catch (error: any) {
      console.error("下载 PIE exe 失败，尝试 phar 版本:", error.message);
    }

    // 备用：下载 phar 版本
    try {
      const piePharUrl =
        "https://github.com/php/pie/releases/latest/download/pie.phar";
      console.log(`下载 PIE phar: ${piePharUrl}`);
      await this.downloadFile(piePharUrl, piePharPath);
      console.log("PIE phar 下载完成");
      return { path: piePharPath, isExe: false };
    } catch (error: any) {
      console.error("下载 PIE phar 失败:", error.message);
      return null;
    }
  }

  /**
   * 使用 PIE 安装扩展
   * 参考: https://github.com/php/pie/blob/1.4.x/docs/usage.md
   *
   * Windows 上使用 --with-php-path 指定目标 PHP 版本：
   * pie install --with-php-path=C:\php-8.3.6\php.exe vendor/package
   */
  private async installWithPie(
    phpPath: string,
    extName: string,
    packageName?: string
  ): Promise<{ success: boolean; message: string }> {
    const pieInfo = await this.ensurePieInstalled();
    if (!pieInfo) {
      return { success: false, message: "PIE 下载失败，无法使用 PIE 安装" };
    }

    const phpExe = join(phpPath, "php.exe");
    // 使用 package name（如 phpredis/phpredis）或扩展名
    const pkg = packageName || extName;

    try {
      console.log(`使用 PIE 安装扩展: ${pkg}`);

      let cmd: string;
      if (pieInfo.isExe) {
        // 使用 PIE Windows 可执行文件，通过 --with-php-path 指定目标 PHP
        cmd = `"${pieInfo.path}" install --with-php-path="${phpExe}" ${pkg}`;
      } else {
        // 使用 phar 版本，需要 PHP 来运行
        cmd = `"${phpExe}" "${pieInfo.path}" install ${pkg}`;
      }

      console.log(`执行命令: ${cmd}`);

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 300000, // 5 分钟超时
        windowsHide: true,
        env: {
          ...process.env,
          // 跳过 Box Requirements Checker（如果有问题）
          BOX_REQUIREMENT_CHECKER: "0",
        },
      });

      console.log("PIE 输出:", stdout);
      if (stderr) console.log("PIE stderr:", stderr);

      // 检查是否安装成功
      // 成功信息示例: "Install complete", "Already installed", "Extension is enabled and loaded"
      if (
        stdout.includes("Install complete") ||
        stdout.includes("Already installed") ||
        stdout.includes("Extension is enabled")
      ) {
        return { success: true, message: `${extName} 扩展通过 PIE 安装成功` };
      } else if (stdout.includes("extension=")) {
        return {
          success: true,
          message: `${extName} 扩展安装成功，请检查 php.ini 配置`,
        };
      }

      // 如果有任何输出但没有明显错误，可能也是成功的
      if (
        stdout &&
        !stdout.includes("Error") &&
        !stdout.includes("Exception")
      ) {
        return {
          success: true,
          message: `${extName} 扩展安装完成\n\n${stdout}`,
        };
      }

      return {
        success: false,
        message: `PIE 安装输出: ${stdout}\n${stderr || ""}`,
      };
    } catch (error: any) {
      console.error("PIE 安装失败:", error.message);
      // 提取有用的错误信息
      let errorMsg = error.message;
      if (error.stdout) errorMsg += `\n输出: ${error.stdout}`;
      if (error.stderr) errorMsg += `\n错误: ${error.stderr}`;
      return { success: false, message: `PIE 安装失败: ${errorMsg}` };
    }
  }

  /**
   * 安装扩展（使用 PIE）
   */
  async installExtension(
    version: string,
    extName: string,
    downloadUrl?: string,
    packageName?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);
      const extDir = join(phpPath, "ext");

      if (!existsSync(extDir)) {
        return { success: false, message: "PHP 扩展目录不存在" };
      }

      // 获取 PHP 信息
      const phpInfo = await this.getPhpInfo(phpPath);
      if (!phpInfo) {
        return { success: false, message: "无法获取 PHP 版本信息" };
      }

      // 使用 PIE 安装
      console.log(`使用 PIE 安装扩展 ${extName}...`);
      const pieResult = await this.installWithPie(
        phpPath,
        extName,
        packageName
      );

      return pieResult;
    } catch (error: any) {
      console.error(`安装扩展 ${extName} 失败:`, error);
      return { success: false, message: `安装失败: ${error.message}` };
    }
  }

  /**
   * 下载扩展文件
   */
  private async downloadExtension(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest);
      const protocol = url.startsWith("https") ? https : http;

      const request = protocol.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
        (response) => {
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307
          ) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              file.close();
              if (existsSync(dest)) unlinkSync(dest);
              this.downloadExtension(redirectUrl, dest)
                .then(resolve)
                .catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`下载失败，状态码: ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(
            response.headers["content-length"] || "0",
            10
          );
          let downloadedSize = 0;
          let lastProgressTime = Date.now();

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            const now = Date.now();
            if (now - lastProgressTime > 300) {
              const progress =
                totalSize > 0
                  ? Math.round((downloadedSize / totalSize) * 100)
                  : 0;
              sendDownloadProgress(
                "php-ext",
                progress,
                downloadedSize,
                totalSize
              );
              lastProgressTime = now;
            }
          });

          response.pipe(file);
          file.on("finish", () => {
            file.close();
            sendDownloadProgress("php-ext", 100, totalSize, totalSize);
            resolve();
          });
        }
      );

      request.on("error", (err) => {
        file.close();
        if (existsSync(dest)) unlinkSync(dest);
        reject(err);
      });

      request.setTimeout(120000, () => {
        request.destroy();
        reject(new Error("下载超时"));
      });
    });
  }

  /**
   * 解压 ZIP 文件
   */
  private async unzipFile(zipPath: string, destPath: string): Promise<void> {
    const { createReadStream } = await import("fs");
    const unzipper = await import("unzipper");
    const { pipeline } = await import("stream/promises");

    await pipeline(
      createReadStream(zipPath),
      unzipper.Extract({ path: destPath })
    );
  }

  /**
   * 检查 URL 是否存在
   */
  private async checkUrlExists(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith("https") ? https : http;
      const request = protocol.request(
        url,
        { method: "HEAD", timeout: 5000 },
        (response) => {
          resolve(response.statusCode === 200);
        }
      );
      request.on("error", () => resolve(false));
      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
      request.end();
    });
  }

  /**
   * 获取 HTML 内容
   */
  private async fetchHtmlContent(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;
      const request = protocol.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          timeout: 15000,
        },
        (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              this.fetchHtmlContent(redirectUrl).then(resolve).catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          let html = "";
          response.on("data", (chunk) => (html += chunk));
          response.on("end", () => resolve(html));
        }
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("请求超时"));
      });
    });
  }

  /**
   * 获取 php.ini 配置内容
   */
  async getConfig(version: string): Promise<string> {
    const phpPath = this.configStore.getPhpPath(version);
    const iniPath = join(phpPath, "php.ini");

    if (!existsSync(iniPath)) {
      return "";
    }

    return readFileSync(iniPath, "utf-8");
  }

  /**
   * 保存 php.ini 配置
   */
  async saveConfig(
    version: string,
    config: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const phpPath = this.configStore.getPhpPath(version);
      const iniPath = join(phpPath, "php.ini");

      writeFileSync(iniPath, config);
      return { success: true, message: "php.ini 保存成功" };
    } catch (error: any) {
      return { success: false, message: `保存失败: ${error.message}` };
    }
  }

  // ==================== 私有方法 ====================

  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 确保目标目录存在
      const destDir = require("path").dirname(dest);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      const file = createWriteStream(dest);
      const protocol = url.startsWith("https") ? https : http;

      console.log(`开始下载: ${url}`);

      const request = protocol.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
        (response) => {
          // 处理重定向
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              file.close();
              if (existsSync(dest)) unlinkSync(dest);
              console.log(`重定向到: ${redirectUrl}`);
              this.downloadFile(redirectUrl, dest).then(resolve).catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            file.close();
            if (existsSync(dest)) unlinkSync(dest);
            reject(
              new Error(`下载失败，状态码: ${response.statusCode}，URL: ${url}`)
            );
            return;
          }

          const totalSize = parseInt(
            response.headers["content-length"] || "0",
            10
          );
          let downloadedSize = 0;
          let lastProgressTime = Date.now();

          response.on("data", (chunk) => {
            downloadedSize += chunk.length;
            const now = Date.now();
            // 每500ms发送一次进度
            if (now - lastProgressTime > 500) {
              const progress =
                totalSize > 0
                  ? Math.round((downloadedSize / totalSize) * 100)
                  : 0;
              sendDownloadProgress("php", progress, downloadedSize, totalSize);
              lastProgressTime = now;
            }
          });

          response.pipe(file);
          file.on("finish", () => {
            file.close();
            sendDownloadProgress("php", 100, totalSize, totalSize);
            console.log("下载完成");
            resolve();
          });
          file.on("error", (err) => {
            file.close();
            if (existsSync(dest)) unlinkSync(dest);
            reject(err);
          });
        }
      );

      request.on("error", (err) => {
        file.close();
        if (existsSync(dest)) unlinkSync(dest);
        reject(new Error(`网络错误: ${err.message}`));
      });

      // 设置超时 15 分钟（PHP包较大，国际网络可能较慢）
      request.setTimeout(900000, () => {
        request.destroy();
        file.close();
        if (existsSync(dest)) unlinkSync(dest);
        reject(new Error("下载超时（15分钟）"));
      });
    });
  }

  private async unzip(zipPath: string, destPath: string): Promise<void> {
    // 确保目标目录存在
    if (!existsSync(destPath)) {
      mkdirSync(destPath, { recursive: true });
    }

    const { createReadStream } = await import("fs");
    const unzipper = await import("unzipper");

    return new Promise((resolve, reject) => {
      const stream = createReadStream(zipPath).pipe(
        unzipper.Extract({ path: destPath })
      );

      stream.on("close", () => {
        console.log("解压完成:", destPath);
        resolve();
      });

      stream.on("error", (err: Error) => {
        console.error("解压错误:", err);
        reject(new Error(`解压失败: ${err.message}`));
      });
    });
  }

  private async createDefaultPhpIni(phpPath: string): Promise<void> {
    const devIniPath = join(phpPath, "php.ini-development");
    const iniPath = join(phpPath, "php.ini");

    if (existsSync(devIniPath) && !existsSync(iniPath)) {
      let content = readFileSync(devIniPath, "utf-8");

      // 设置常用配置
      content = content.replace(
        /;extension_dir = "ext"/,
        'extension_dir = "ext"'
      );
      content = content.replace(/;extension=curl/, "extension=curl");
      content = content.replace(/;extension=fileinfo/, "extension=fileinfo");
      content = content.replace(/;extension=gd/, "extension=gd");
      content = content.replace(/;extension=mbstring/, "extension=mbstring");
      content = content.replace(/;extension=mysqli/, "extension=mysqli");
      content = content.replace(/;extension=openssl/, "extension=openssl");
      content = content.replace(/;extension=pdo_mysql/, "extension=pdo_mysql");
      content = content.replace(/;extension=zip/, "extension=zip");

      // 设置时区
      content = content.replace(
        /;date.timezone =/,
        "date.timezone = Asia/Shanghai"
      );

      writeFileSync(iniPath, content);
    }
  }

  private async addToPath(phpPath: string): Promise<void> {
    try {
      // 先移除所有 PHP 相关路径，再添加新路径
      const tempScriptPath = join(
        this.configStore.getTempPath(),
        "update_path.ps1"
      );
      mkdirSync(this.configStore.getTempPath(), { recursive: true });

      // 将路径作为参数传递给脚本，避免转义问题
      // 使用纯英文避免编码问题
      const psScript = `
param([string]$NewPhpPath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { $userPath = '' }

Write-Host "Original PATH length: $($userPath.Length)"
Write-Host "New PHP path: $NewPhpPath"

$paths = $userPath -split ';' | Where-Object { $_ -ne '' -and $_.Trim() -ne '' }

Write-Host "Original path count: $($paths.Count)"

$filteredPaths = @()
foreach ($p in $paths) {
    $pathLower = $p.ToLower()
    $isPhpPath = $false
    
    if ($pathLower -like '*\\php\\php-*' -or 
        $pathLower -like '*\\php-*\\*' -or
        $pathLower -like '*phpenv*php*' -or
        $pathLower -like '*phper*php*' -or
        $pathLower -like '*xampp*php*' -or
        $pathLower -like '*wamp*php*' -or
        $pathLower -like '*laragon*php*' -or
        $pathLower -match '\\\\php\\\\?$' -or
        $pathLower -match '\\\\php-\\d') {
        $isPhpPath = $true
        Write-Host "Removing PHP path: $p"
    }
    
    if (-not $isPhpPath -and (Test-Path (Join-Path $p 'php.exe') -ErrorAction SilentlyContinue)) {
        $isPhpPath = $true
        Write-Host "Removing path with php.exe: $p"
    }
    
    if (-not $isPhpPath) {
        $filteredPaths += $p
    }
}

Write-Host "Filtered path count: $($filteredPaths.Count)"

$allPaths = @($NewPhpPath) + $filteredPaths
$newPath = $allPaths -join ';'

Write-Host "New PATH starts with: $($newPath.Substring(0, [Math]::Min(150, $newPath.Length)))..."

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')

Start-Sleep -Milliseconds 500
$verifyPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($verifyPath -and $verifyPath.Contains($NewPhpPath)) {
    Write-Host "SUCCESS: PHP path added to user PATH"
} else {
    Write-Host "WARNING: PATH update may not have taken effect"
}
`;

      writeFileSync(tempScriptPath, psScript, "utf-8");

      // 使用参数传递路径
      const { stdout, stderr } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -NewPhpPath "${phpPath}"`,
        { windowsHide: true, timeout: 30000 }
      );

      console.log("PATH 更新输出:", stdout);
      if (stderr) console.error("PATH stderr:", stderr);

      // 检查是否成功
      if (stdout.includes("SUCCESS")) {
        console.log("PATH 更新成功");
      } else {
        console.warn("PATH 更新可能未完全成功");
      }

      // 清理临时脚本
      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath);
      }
    } catch (error: any) {
      console.error("添加 PATH 失败:", error);
      throw new Error(`设置环境变量失败: ${error.message}`);
    }
  }

  private async removeFromPath(phpPath: string): Promise<void> {
    try {
      const escapedPhpPath = phpPath.replace(/\\/g, "\\\\");
      const psCommand = `
        $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        if ($userPath -eq $null) { $userPath = '' }
        $paths = $userPath -split ';' | Where-Object { $_ -ne '' -and $_ -ne '${escapedPhpPath}' }
        $newPath = $paths -join ';'
        [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
        Write-Host "PATH removed successfully"
      `;
      const { stdout, stderr } = await execAsync(
        `powershell -Command "${psCommand}"`,
        { windowsHide: true }
      );
      console.log("移除 PATH 成功:", stdout);
      if (stderr) console.error("PATH stderr:", stderr);
    } catch (error: any) {
      console.error("移除 PATH 失败:", error);
    }
  }

  private removeDirectory(dir: string): void {
    if (existsSync(dir)) {
      const files = readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = join(dir, file.name);
        if (file.isDirectory()) {
          this.removeDirectory(fullPath);
        } else {
          unlinkSync(fullPath);
        }
      }
      rmdirSync(dir);
    }
  }

  // ==================== Composer 管理 ====================

  /**
   * 获取 Composer 状态
   */
  async getComposerStatus(): Promise<{
    installed: boolean;
    version?: string;
    path?: string;
    mirror?: string;
  }> {
    const composerPath = this.getComposerPath();
    const composerBatPath = join(this.configStore.getBasePath(), "tools", "composer.bat");
    const mirror = this.configStore.get("composerMirror") || "";

    console.log("检查 Composer 路径:", composerPath);

    if (!existsSync(composerPath)) {
      console.log("Composer 未安装");
      return { installed: false, mirror };
    }

    let version: string | undefined;

    // 方法1: 尝试直接使用 composer.bat（如果在 PATH 中）
    try {
      console.log("尝试使用 composer --version...");
      const { stdout } = await execAsync("composer --version", {
        windowsHide: true,
        timeout: 15000,
        encoding: "utf8",
      });
      console.log("Composer 输出:", stdout);
      
      // 解析版本号 - 支持多种格式
      // "Composer version 2.9-dev+9497eca6e15b115d25833c68b7c5c76589953b65 (2.9-dev)"
      // "Composer version 2.7.1 2024-01-01"
      const versionMatch = stdout.match(/Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/);
      if (versionMatch) {
        version = versionMatch[1];
        console.log("解析到版本:", version);
        return { installed: true, version, path: composerPath, mirror };
      }
    } catch (e: any) {
      console.log("composer 命令不可用，尝试其他方式:", e.message);
    }

    // 方法2: 使用 composer.bat
    if (existsSync(composerBatPath)) {
      try {
        console.log("尝试使用 composer.bat...");
        const { stdout } = await execAsync(`"${composerBatPath}" --version`, {
          windowsHide: true,
          timeout: 15000,
          encoding: "utf8",
        });
        const versionMatch = stdout.match(/Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/);
        if (versionMatch) {
          version = versionMatch[1];
          console.log("解析到版本:", version);
          return { installed: true, version, path: composerPath, mirror };
        }
      } catch (e: any) {
        console.log("composer.bat 执行失败:", e.message);
      }
    }

    // 方法3: 使用 PHP 运行 composer.phar
    try {
      const activePhp = this.configStore.get("activePhpVersion");
      if (activePhp) {
        const phpPath = this.configStore.getPhpPath(activePhp);
        const phpExe = join(phpPath, "php.exe");

        if (existsSync(phpExe)) {
          console.log("尝试使用 PHP 运行 composer.phar...");
          const { stdout } = await execAsync(`"${phpExe}" "${composerPath}" --version`, {
            windowsHide: true,
            timeout: 15000,
            encoding: "utf8",
          });
          const versionMatch = stdout.match(/Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/);
          if (versionMatch) {
            version = versionMatch[1];
            console.log("解析到版本:", version);
          }
        }
      }
    } catch (e: any) {
      console.log("PHP 运行 composer.phar 失败:", e.message);
    }

    return { installed: true, version, path: composerPath, mirror };
  }

  /**
   * 获取 Composer 路径
   */
  private getComposerPath(): string {
    return join(this.configStore.getBasePath(), "tools", "composer.phar");
  }

  /**
   * 安装 Composer
   */
  async installComposer(): Promise<{ success: boolean; message: string }> {
    try {
      const toolsDir = join(this.configStore.getBasePath(), "tools");
      const composerPath = join(toolsDir, "composer.phar");
      const composerBatPath = join(toolsDir, "composer.bat");

      // 确保目录存在
      if (!existsSync(toolsDir)) {
        mkdirSync(toolsDir, { recursive: true });
      }

      // 下载 Composer
      console.log("正在下载 Composer...");
      
      // 尝试多个下载源
      const urls = [
        "https://getcomposer.org/composer.phar",
        "https://mirrors.aliyun.com/composer/composer.phar",
      ];

      let downloaded = false;
      let lastError: Error | null = null;

      for (const url of urls) {
        try {
          console.log(`尝试从 ${url} 下载...`);
          await this.downloadFile(url, composerPath);
          downloaded = true;
          break;
        } catch (e: any) {
          console.error(`从 ${url} 下载失败:`, e.message);
          lastError = e;
        }
      }

      if (!downloaded) {
        throw lastError || new Error("所有下载源均失败");
      }

      // 验证文件是否下载成功
      if (!existsSync(composerPath)) {
        return { success: false, message: "Composer 下载失败，文件不存在" };
      }

      // 创建 composer.bat 批处理文件
      const batContent = `@echo off\r\nphp "%~dp0composer.phar" %*`;
      writeFileSync(composerBatPath, batContent);
      console.log("创建 composer.bat:", composerBatPath);

      // 添加到环境变量
      await this.addComposerToPath(toolsDir);

      // 验证安装
      const activePhp = this.configStore.get("activePhpVersion");
      if (activePhp) {
        const phpPath = this.configStore.getPhpPath(activePhp);
        const phpExe = join(phpPath, "php.exe");

        if (existsSync(phpExe)) {
          try {
            const { stdout } = await execAsync(`"${phpExe}" "${composerPath}" --version`, {
              windowsHide: true,
              timeout: 10000,
            });
            console.log("Composer 安装成功:", stdout);
          } catch (e) {
            console.log("Composer 已下载，但验证失败（可能是 PHP 问题）");
          }
        }
      }

      return { success: true, message: "Composer 安装成功，已添加到系统环境变量" };
    } catch (error: any) {
      console.error("Composer 安装失败:", error);
      return { success: false, message: `安装失败: ${error.message}` };
    }
  }

  /**
   * 卸载 Composer
   */
  async uninstallComposer(): Promise<{ success: boolean; message: string }> {
    try {
      const toolsDir = join(this.configStore.getBasePath(), "tools");
      const composerPath = join(toolsDir, "composer.phar");
      const composerBatPath = join(toolsDir, "composer.bat");

      // 删除文件
      if (existsSync(composerPath)) {
        unlinkSync(composerPath);
        console.log("已删除:", composerPath);
      }

      if (existsSync(composerBatPath)) {
        unlinkSync(composerBatPath);
        console.log("已删除:", composerBatPath);
      }

      // 从环境变量移除
      await this.removeComposerFromPath(toolsDir);

      return { success: true, message: "Composer 已卸载" };
    } catch (error: any) {
      console.error("Composer 卸载失败:", error);
      return { success: false, message: `卸载失败: ${error.message}` };
    }
  }

  /**
   * 添加 Composer 到环境变量
   */
  private async addComposerToPath(toolsDir: string): Promise<void> {
    try {
      const tempScriptPath = join(this.configStore.getTempPath(), "add_composer_path.ps1");
      mkdirSync(this.configStore.getTempPath(), { recursive: true });

      const psScript = `
param([string]$ComposerPath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { $userPath = '' }

# Check if already exists
if ($userPath.ToLower().Contains($ComposerPath.ToLower())) {
    Write-Host "Composer path already in PATH"
    exit 0
}

# Add to PATH
$newPath = $ComposerPath + ";" + $userPath
[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')

Write-Host "SUCCESS: Composer path added to user PATH"
`;

      writeFileSync(tempScriptPath, psScript, "utf-8");

      const { stdout } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -ComposerPath "${toolsDir}"`,
        { windowsHide: true, timeout: 30000 }
      );

      console.log("Composer PATH 更新:", stdout);

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath);
      }
    } catch (error: any) {
      console.error("添加 Composer 到 PATH 失败:", error);
    }
  }

  /**
   * 从环境变量移除 Composer
   */
  private async removeComposerFromPath(toolsDir: string): Promise<void> {
    try {
      const tempScriptPath = join(this.configStore.getTempPath(), "remove_composer_path.ps1");
      mkdirSync(this.configStore.getTempPath(), { recursive: true });

      const psScript = `
param([string]$ComposerPath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { exit 0 }

$paths = $userPath -split ';' | Where-Object { $_ -ne '' -and $_.ToLower() -ne $ComposerPath.ToLower() }
$newPath = $paths -join ';'

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')

Write-Host "SUCCESS: Composer path removed from user PATH"
`;

      writeFileSync(tempScriptPath, psScript, "utf-8");

      const { stdout } = await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -ComposerPath "${toolsDir}"`,
        { windowsHide: true, timeout: 30000 }
      );

      console.log("Composer PATH 移除:", stdout);

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath);
      }
    } catch (error: any) {
      console.error("从 PATH 移除 Composer 失败:", error);
    }
  }

  /**
   * 设置 Composer 镜像
   */
  async setComposerMirror(
    mirror: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const activePhp = this.configStore.get("activePhpVersion");
      if (!activePhp) {
        return { success: false, message: "请先设置默认 PHP 版本" };
      }

      const composerPath = this.getComposerPath();
      if (!existsSync(composerPath)) {
        return { success: false, message: "Composer 未安装" };
      }

      const phpPath = this.configStore.getPhpPath(activePhp);
      const phpExe = join(phpPath, "php.exe");

      // 检查 PHP 是否存在
      if (!existsSync(phpExe)) {
        return { success: false, message: `PHP 未找到: ${phpExe}` };
      }

      // 先移除旧的镜像配置
      try {
        await execAsync(
          `"${phpExe}" "${composerPath}" config -g --unset repos.packagist`,
          { windowsHide: true, timeout: 30000 }
        );
      } catch (e) {
        // 忽略移除失败
      }

      if (mirror) {
        // 设置新镜像
        await execAsync(
          `"${phpExe}" "${composerPath}" config -g repos.packagist composer ${mirror}`,
          { windowsHide: true, timeout: 30000 }
        );
      }

      // 保存到配置
      this.configStore.set("composerMirror", mirror);

      const mirrorName = this.getMirrorName(mirror);
      return {
        success: true,
        message: mirror ? `已设置镜像为: ${mirrorName}` : "已恢复为官方源",
      };
    } catch (error: any) {
      console.error("设置镜像失败:", error);
      // 即使命令执行失败，也保存配置（因为镜像配置主要在创建项目时使用）
      this.configStore.set("composerMirror", mirror);
      const mirrorName = this.getMirrorName(mirror);
      return {
        success: true,
        message: mirror ? `镜像配置已保存: ${mirrorName}` : "已恢复为官方源",
      };
    }
  }

  /**
   * 获取镜像名称
   */
  private getMirrorName(mirror: string): string {
    const mirrors: Record<string, string> = {
      "https://mirrors.aliyun.com/composer/": "阿里云镜像",
      "https://mirrors.cloud.tencent.com/composer/": "腾讯云镜像",
      "https://mirrors.huaweicloud.com/repository/php/": "华为云镜像",
      "https://packagist.phpcomposer.com": "中国全量镜像",
    };
    return mirrors[mirror] || mirror;
  }

  /**
   * 创建 Laravel 项目
   */
  async createLaravelProject(
    projectName: string,
    targetDir: string
  ): Promise<{ success: boolean; message: string; projectPath?: string }> {
    try {
      const activePhp = this.configStore.get("activePhpVersion");
      if (!activePhp) {
        return { success: false, message: "请先设置默认 PHP 版本" };
      }

      const composerPath = this.getComposerPath();
      if (!existsSync(composerPath)) {
        return { success: false, message: "Composer 未安装，请先安装 Composer" };
      }

      const phpPath = this.configStore.getPhpPath(activePhp);
      const phpExe = join(phpPath, "php.exe");

      // 检查 PHP 是否存在
      if (!existsSync(phpExe)) {
        return { success: false, message: `PHP 未找到: ${phpExe}` };
      }

      // 确保目标目录存在
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      const projectPath = join(targetDir, projectName);

      // 检查项目目录是否已存在
      if (existsSync(projectPath)) {
        return { success: false, message: `项目目录已存在: ${projectPath}` };
      }

      console.log(`创建 Laravel 项目: ${projectName} 在 ${targetDir}`);

      // 获取镜像配置
      const mirror = this.configStore.get("composerMirror");
      let repoOption = "";
      if (mirror) {
        // 使用环境变量设置镜像
        repoOption = `--repository=${mirror}`;
      }

      // 使用 composer create-project 创建 Laravel 项目
      const cmd = `"${phpExe}" "${composerPath}" create-project --prefer-dist ${repoOption} laravel/laravel "${projectName}"`;

      console.log("执行命令:", cmd);

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: targetDir,
        windowsHide: true,
        timeout: 600000, // 10 分钟超时
        env: {
          ...process.env,
          COMPOSER_PROCESS_TIMEOUT: "600",
          COMPOSER_HOME: join(this.configStore.getBasePath(), "tools", "composer"),
        },
      });

      console.log("Composer 输出:", stdout);
      if (stderr) console.log("Composer stderr:", stderr);

      // 验证项目创建成功
      if (existsSync(join(projectPath, "artisan"))) {
        return {
          success: true,
          message: `Laravel 项目 "${projectName}" 创建成功`,
          projectPath,
        };
      } else {
        return { success: false, message: "项目创建失败，请查看日志" };
      }
    } catch (error: any) {
      console.error("创建 Laravel 项目失败:", error);
      let errorMsg = error.message;
      if (error.stderr) {
        errorMsg = error.stderr;
      }
      return { success: false, message: `创建失败: ${errorMsg}` };
    }
  }
}
