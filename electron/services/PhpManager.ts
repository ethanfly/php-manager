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
  supportedPhpVersions?: string[]; // 支持的 PHP 版本列表
  notAvailableReason?: string; // 不可用原因
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
   * 获取可安装的 PECL 扩展列表（从 pecl.php.net 和 windows.php.net 获取）
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

      const { majorMinor, isNts, compiler } = phpInfo;
      console.log(
        `PHP Info: ${majorMinor}, NTS: ${isNts}, Compiler: ${compiler}`
      );

      // 获取已安装的扩展
      const installedExts = await this.getExtensions(version);
      const installedNames = installedExts.map((e) => e.name.toLowerCase());

      // 从 PECL 统计页面爬取热门扩展列表
      console.log(`[PECL] Fetching popular extensions from stats page...`);
      let popularExtensions = await this.fetchPeclPopularExtensions();

      // 如果爬取失败，使用本地缓存列表
      if (popularExtensions.length === 0) {
        console.log(`[PECL] Using cached extension list`);
        popularExtensions = this.getPeclExtensionsList();
      }

      // 搜索过滤
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        popularExtensions = popularExtensions.filter(
          (ext) =>
            ext.name.toLowerCase().includes(keyword) ||
            ext.description.toLowerCase().includes(keyword)
        );
      }

      console.log(`[PECL] Found ${popularExtensions.length} extensions`);

      // 过滤已安装的扩展
      const availableExts = popularExtensions.filter(
        (ext) => !installedNames.includes(ext.name.toLowerCase())
      );

      // 直接返回列表，不检查 DLL（安装时再检查）
      const limit = searchKeyword ? 50 : 30;
      for (const ext of availableExts.slice(0, limit)) {
        extensions.push({
          name: ext.name,
          version: "latest", // 安装时获取最新版本
          downloadUrl: "", // 安装时获取下载链接
          description: ext.description,
        });
      }

      console.log(`[PECL] Showing ${extensions.length} extensions`);
      return extensions;
    } catch (error: any) {
      console.error("获取可用扩展列表失败:", error);
      return this.getDefaultExtensionList(version);
    }
  }

  /**
   * 从 PECL 统计页面爬取热门扩展列表
   * https://pecl.php.net/package-stats.php
   */
  private async fetchPeclPopularExtensions(): Promise<
    { name: string; description: string }[]
  > {
    try {
      const url = "https://pecl.php.net/package-stats.php";
      const html = await this.fetchHtmlContent(url);

      if (html.length < 1000) {
        console.log(`[PECL] Stats page too short: ${html.length}`);
        return [];
      }

      const extensions: { name: string; description: string }[] = [];

      // 匹配扩展名: <a href="/package/redis">redis</a> 或 [redis](/package/redis)
      // HTML 格式: <a href="/package/扩展名">扩展名</a>
      const extPattern =
        /<a\s+href="\/package\/([a-zA-Z0-9_]+)"[^>]*>\1<\/a>/gi;
      let match;

      while ((match = extPattern.exec(html)) !== null) {
        const name = match[1];
        // 排除一些非扩展的链接
        if (name && !extensions.find((e) => e.name === name)) {
          extensions.push({
            name: name,
            description: this.getExtensionDescription(name),
          });
        }
      }

      // 备用模式: 匹配 href="/package/xxx"
      if (extensions.length === 0) {
        const altPattern = /href="\/package\/([a-zA-Z0-9_]+)"/gi;
        while ((match = altPattern.exec(html)) !== null) {
          const name = match[1];
          if (
            name &&
            !extensions.find((e) => e.name === name) &&
            !["stats", "search", "changelog"].includes(name.toLowerCase())
          ) {
            extensions.push({
              name: name,
              description: this.getExtensionDescription(name),
            });
          }
        }
      }

      console.log(
        `[PECL] Scraped ${extensions.length} extensions from stats page`
      );
      return extensions;
    } catch (error: any) {
      console.error(`[PECL] Failed to fetch stats page: ${error.message}`);
      return [];
    }
  }

  /**
   * 获取扩展描述（本地映射）
   */
  private getExtensionDescription(name: string): string {
    const descriptions: Record<string, string> = {
      imagick: "ImageMagick 图像处理",
      xdebug: "调试和性能分析工具",
      redis: "PHP Redis 客户端扩展",
      apcu: "APCu 用户数据缓存",
      yaml: "YAML 数据格式支持",
      memcached: "Memcached 缓存客户端",
      mongodb: "MongoDB 数据库驱动",
      amqp: "AMQP 消息队列 (RabbitMQ)",
      mcrypt: "Mcrypt 加密扩展",
      igbinary: "高效二进制序列化",
      ssh2: "SSH2 协议支持",
      mailparse: "邮件解析扩展",
      msgpack: "MessagePack 序列化",
      grpc: "gRPC 远程调用",
      rdkafka: "Kafka 客户端",
      oauth: "OAuth 认证支持",
      protobuf: "Protocol Buffers",
      event: "事件驱动扩展",
      zip: "ZIP 压缩支持",
      xlswriter: "Excel 文件写入",
      rar: "RAR 压缩支持",
      swoole: "高性能异步框架",
      uuid: "UUID 生成",
      ds: "数据结构扩展",
      ast: "PHP AST 抽象语法树",
      pcov: "代码覆盖率驱动",
      decimal: "任意精度小数",
      ev: "libev 事件循环",
      inotify: "文件系统监控",
      solr: "Apache Solr 客户端",
      htscanner: "htaccess 支持",
      timezonedb: "时区数据库",
      gnupg: "GnuPG 加密",
      geoip: "GeoIP 地理定位",
      psr: "PSR 接口",
      parallel: "并行处理",
      opentelemetry: "OpenTelemetry 追踪",
      sqlsrv: "SQL Server 驱动",
      pdo_sqlsrv: "PDO SQL Server",
      oci8: "Oracle 数据库",
      couchbase: "Couchbase 客户端",
      zstd: "Zstandard 压缩",
      brotli: "Brotli 压缩",
      maxminddb: "MaxMind GeoIP2",
    };
    return descriptions[name.toLowerCase()] || `${name} extension`;
  }

  /**
   * 获取 PECL 常用扩展列表（本地缓存，爬取失败时使用）
   */
  private getPeclExtensionsList(): { name: string; description: string }[] {
    // 基于 PECL 下载统计的热门扩展列表
    return [
      { name: "imagick", description: "ImageMagick 图像处理" },
      { name: "xdebug", description: "调试和性能分析工具" },
      { name: "redis", description: "PHP Redis 客户端扩展" },
      { name: "apcu", description: "APCu 用户数据缓存" },
      { name: "yaml", description: "YAML 数据格式支持" },
      { name: "memcached", description: "Memcached 缓存客户端" },
      { name: "mongodb", description: "MongoDB 数据库驱动" },
      { name: "amqp", description: "AMQP 消息队列 (RabbitMQ)" },
      { name: "mcrypt", description: "Mcrypt 加密扩展" },
      { name: "igbinary", description: "高效二进制序列化" },
      { name: "ssh2", description: "SSH2 协议支持" },
      { name: "mailparse", description: "邮件解析扩展" },
      { name: "msgpack", description: "MessagePack 序列化" },
      { name: "grpc", description: "gRPC 远程调用" },
      { name: "rdkafka", description: "Kafka 客户端" },
      { name: "oauth", description: "OAuth 认证支持" },
      { name: "protobuf", description: "Protocol Buffers" },
      { name: "event", description: "事件驱动扩展" },
      { name: "zip", description: "ZIP 压缩支持" },
      { name: "xlswriter", description: "Excel 文件写入" },
      { name: "pcov", description: "代码覆盖率驱动" },
      { name: "swoole", description: "高性能异步框架" },
      { name: "uuid", description: "UUID 生成" },
      { name: "ds", description: "数据结构扩展" },
      { name: "ast", description: "PHP AST 抽象语法树" },
      { name: "rar", description: "RAR 压缩支持" },
      { name: "decimal", description: "任意精度小数" },
      { name: "ev", description: "libev 事件循环" },
      { name: "inotify", description: "文件系统监控" },
      { name: "solr", description: "Apache Solr 客户端" },
    ];
  }

  /**
   * 从 PECL 获取扩展的 DLL 下载信息
   * 1. 爬取详情页 https://pecl.php.net/package/{ext} 获取最新版本
   * 2. 爬取 Windows 页 https://pecl.php.net/package/{ext}/{version}/windows 获取 DLL 链接
   */
  private async fetchPeclDllInfo(
    extName: string,
    phpVersion: string,
    tsType: string,
    compiler: string
  ): Promise<{
    version?: string;
    downloadUrl?: string;
    availablePhpVersions?: string[];
  }> {
    try {
      // 1. 获取详情页，提取最新版本号
      const packageUrl = `https://pecl.php.net/package/${extName}`;
      console.log(`[PECL DLL] Fetching: ${packageUrl}`);
      let html = await this.fetchHtmlContent(packageUrl);
      html = this.decodeHtmlEntities(html);

      // 提取有 Windows DLL 的版本号
      // 格式: <a href="/package/redis/6.3.0/windows">DLL</a>
      const windowsVersions: string[] = [];
      const dllPattern = new RegExp(
        `href=["']/package/${extName}/([\\d.]+(?:RC\\d+|beta\\d*|alpha\\d*)?)/windows["']`,
        "gi"
      );
      let match;
      while ((match = dllPattern.exec(html)) !== null) {
        if (!windowsVersions.includes(match[1])) {
          windowsVersions.push(match[1]);
        }
      }

      console.log(
        `[PECL DLL] ${extName}: versions with DLL: ${windowsVersions
          .slice(0, 5)
          .join(", ")}`
      );

      if (windowsVersions.length === 0) {
        // 尝试获取任何版本
        const anyVersionPattern = new RegExp(
          `href=["']/package/${extName}/([\\d.]+(?:RC\\d+|beta\\d*|alpha\\d*)?)["']`,
          "gi"
        );
        while ((match = anyVersionPattern.exec(html)) !== null) {
          if (!windowsVersions.includes(match[1])) {
            windowsVersions.push(match[1]);
          }
        }
      }

      if (windowsVersions.length === 0) {
        console.log(`[PECL DLL] ${extName}: no versions found`);
        return {};
      }

      // 选择最新的稳定版本
      const stableVersions = windowsVersions.filter(
        (v) => !/RC|beta|alpha/i.test(v)
      );
      const latestVersion = stableVersions[0] || windowsVersions[0];
      console.log(`[PECL DLL] ${extName}: selected version ${latestVersion}`);

      // 2. 获取 Windows DLL 页面
      const windowsUrl = `https://pecl.php.net/package/${extName}/${latestVersion}/windows`;
      console.log(`[PECL DLL] Fetching: ${windowsUrl}`);
      let windowsHtml = await this.fetchHtmlContent(windowsUrl);
      windowsHtml = this.decodeHtmlEntities(windowsHtml);

      // 提取所有 .zip 下载链接
      const zipLinks: string[] = [];
      const zipPattern = /href=["'](https?:\/\/[^"']*\.zip)["']/gi;
      while ((match = zipPattern.exec(windowsHtml)) !== null) {
        zipLinks.push(match[1]);
      }

      console.log(
        `[PECL DLL] ${extName}: found ${zipLinks.length} download links`
      );

      // 查找匹配当前 PHP 版本的 DLL
      const compilers = [compiler, "vs17", "vs16", "vc15"];
      let matchedUrl: string | null = null;

      for (const url of zipLinks) {
        const decodedUrl = decodeURIComponent(url).toLowerCase();

        for (const comp of compilers) {
          // 格式: php_redis-6.3.0-8.4-nts-vs17-x64.zip
          if (
            decodedUrl.includes(`-${phpVersion}-${tsType}-${comp}-x64.zip`) ||
            decodedUrl.includes(`-${phpVersion}-${tsType}-${comp}-x86.zip`)
          ) {
            matchedUrl = url;
            console.log(`[PECL DLL] ${extName}: matched DLL ${url}`);
            break;
          }
        }
        if (matchedUrl) break;
      }

      if (matchedUrl) {
        return {
          version: latestVersion,
          downloadUrl: matchedUrl,
        };
      }

      // 提取可用的 PHP 版本列表
      const availablePhpVersions: string[] = [];
      for (const url of zipLinks) {
        const versionMatch = url.match(/-(\d+\.\d+)-(nts|ts)-/i);
        if (versionMatch) {
          const phpVer = `${versionMatch[1]}-${versionMatch[2]}`;
          if (!availablePhpVersions.includes(phpVer)) {
            availablePhpVersions.push(phpVer);
          }
        }
      }

      console.log(
        `[PECL DLL] ${extName}: available PHP versions: ${availablePhpVersions.join(
          ", "
        )}`
      );

      return {
        version: latestVersion,
        availablePhpVersions: availablePhpVersions.sort().reverse(),
      };
    } catch (error: any) {
      console.error(`[PECL DLL] ${extName}: error - ${error.message}`);
      return {};
    }
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
      .replace(/&apos;/g, "'")
      .replace(/&hyphen;/g, "-")
      .replace(/&lowbar;/g, "_")
      .replace(/&#(\d+);/g, (_, code) =>
        String.fromCharCode(parseInt(code, 10))
      )
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      )
      .replace(/&nbsp;/g, " ");
  }

  /**
   * 直接检查 PECL DLL URL 是否存在
   * 下载链接格式: https://downloads.php.net/~windows/pecl/releases/{ext}/{version}/php_{ext}-{version}-{php}-{ts}-{compiler}-x64.zip
   */
  private async findPeclDllUrl(
    extName: string,
    extVersion: string,
    phpVersion: string,
    tsType: string,
    compiler: string
  ): Promise<string | null> {
    // 尝试多种编译器版本
    const compilers = [compiler, "vs17", "vs16", "vc15"];
    const architectures = ["x64", "x86"];

    for (const comp of compilers) {
      for (const arch of architectures) {
        const url = `https://downloads.php.net/~windows/pecl/releases/${extName}/${extVersion}/php_${extName}-${extVersion}-${phpVersion}-${tsType}-${comp}-${arch}.zip`;

        try {
          const exists = await this.checkUrlExists(url);
          if (exists) {
            console.log(`[PECL] Found DLL: ${url}`);
            return url;
          }
        } catch (e) {
          // URL doesn't exist, try next
        }
      }
    }

    return null;
  }

  /**
   * 从 PECL 获取扩展信息（包含支持的 PHP 版本）
   */
  private async getExtensionFromPeclWithInfo(
    extName: string,
    phpInfo: { majorMinor: string; isNts: boolean; compiler: string }
  ): Promise<{
    available: boolean;
    extension?: AvailablePeclExtension;
    supportedVersions?: string[];
    latestVersion?: string;
  }> {
    const result = await this.getExtensionFromPeclDetailed(extName, phpInfo);
    return result;
  }

  /**
   * Get extension info from PECL
   * Check https://pecl.php.net/package/{ext}/{ver}/windows to determine if Windows DLL exists
   */
  private async getExtensionFromPeclDetailed(
    extName: string,
    phpInfo: { majorMinor: string; isNts: boolean; compiler: string }
  ): Promise<{
    available: boolean;
    extension?: AvailablePeclExtension;
    supportedVersions?: string[];
    latestVersion?: string;
  }> {
    const { majorMinor, isNts, compiler } = phpInfo;
    const tsType = isNts ? "nts" : "ts";

    try {
      // 1. Get package page and extract versions
      const packageUrl = `https://pecl.php.net/package/${extName}`;
      console.log(`[PECL] ${extName}: fetching ${packageUrl}`);
      let packageHtml = await this.fetchHtmlContent(packageUrl);

      console.log(`[PECL] ${extName}: HTML length ${packageHtml.length}`);

      if (packageHtml.length < 500) {
        console.log(`[PECL] ${extName}: page too short, may not exist`);
        return { available: false };
      }

      // Check if HTML contains encoded entities before decoding
      const hasEncodedPeriod = packageHtml.includes("&period;");
      const hasEncodedSol = packageHtml.includes("&sol;");
      console.log(
        `[PECL] ${extName}: hasEncodedPeriod=${hasEncodedPeriod}, hasEncodedSol=${hasEncodedSol}`
      );

      // Decode HTML entities (PECL uses &period; for . and &sol; for /)
      packageHtml = this.decodeHtmlEntities(packageHtml);

      // Debug: Check if version links exist after decoding
      const hasPackageLink = packageHtml.includes(`/package/${extName}/`);
      const hasWindowsLink = packageHtml.includes("/windows");
      console.log(
        `[PECL] ${extName}: hasPackageLink=${hasPackageLink}, hasWindowsLink=${hasWindowsLink}`
      );

      // Extract version numbers from page - multiple patterns for robustness
      const allVersions: string[] = [];
      let match;

      // Pattern 1: Match /package/extname/x.y.z in href
      // href="/package/amqp/2.2.0" or href='/package/amqp/2.2.0'
      const escapedExtName = extName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const versionPattern1 = new RegExp(
        `href=["']/package/${escapedExtName}/([\\d]+\\.[\\d]+(?:\\.[\\d]+)?(?:RC\\d+|beta\\d*|alpha\\d*)?)["'>]`,
        "gi"
      );
      while ((match = versionPattern1.exec(packageHtml)) !== null) {
        const ver = match[1];
        if (!allVersions.includes(ver)) {
          allVersions.push(ver);
          console.log(`[PECL] ${extName}: found version ${ver} (pattern1)`);
        }
      }

      // Pattern 2: Match version numbers in table cells >x.y.z</a>
      const versionPattern2 =
        />(\d+\.\d+(?:\.\d+)?(?:RC\d+|beta\d*|alpha\d*)?)<\/a>/gi;
      while ((match = versionPattern2.exec(packageHtml)) !== null) {
        const ver = match[1];
        if (!allVersions.includes(ver) && /^\d+\.\d+/.test(ver)) {
          allVersions.push(ver);
          console.log(`[PECL] ${extName}: found version ${ver} (pattern2)`);
        }
      }

      // Pattern 3: Match /windows links to get versions with DLL
      const versionPattern3 = new RegExp(
        `href=["']/package/${escapedExtName}/([\\d]+\\.[\\d]+(?:\\.[\\d]+)?(?:RC\\d+|beta\\d*|alpha\\d*)?)/windows`,
        "gi"
      );
      while ((match = versionPattern3.exec(packageHtml)) !== null) {
        const ver = match[1];
        if (!allVersions.includes(ver)) {
          allVersions.push(ver);
          console.log(
            `[PECL] ${extName}: found version ${ver} with DLL (pattern3)`
          );
        }
      }

      // Sort versions descending, prefer stable
      const uniqueVersions = [...new Set(allVersions)].sort((a, b) => {
        const aParts = a
          .replace(/RC.*|beta.*|alpha.*/i, "")
          .split(".")
          .map(Number);
        const bParts = b
          .replace(/RC.*|beta.*|alpha.*/i, "")
          .split(".")
          .map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const diff = (bParts[i] || 0) - (aParts[i] || 0);
          if (diff !== 0) return diff;
        }
        const aIsStable = !/RC|beta|alpha/i.test(a);
        const bIsStable = !/RC|beta|alpha/i.test(b);
        if (aIsStable !== bIsStable) return aIsStable ? -1 : 1;
        return 0;
      });

      console.log(
        `[PECL] ${extName}: found versions [${uniqueVersions
          .slice(0, 5)
          .join(", ")}]`
      );

      if (uniqueVersions.length === 0) {
        console.log(`[PECL] ${extName}: no versions found`);
        return { available: false };
      }

      // 2. Check /windows page for each version (use fetchHtmlContent directly)
      const versionsWithDll: string[] = [];

      for (const ver of uniqueVersions.slice(0, 3)) {
        const windowsPageUrl = `https://pecl.php.net/package/${extName}/${ver}/windows`;
        console.log(`[PECL] ${extName}: checking ${windowsPageUrl}`);

        try {
          const windowsHtml = await this.fetchHtmlContent(windowsPageUrl);
          // Check if page contains DLL download links (downloads.php.net or .zip)
          if (
            windowsHtml.length > 1000 &&
            (windowsHtml.includes("downloads.php.net") ||
              windowsHtml.includes(".zip"))
          ) {
            versionsWithDll.push(ver);
            console.log(`[PECL] ${extName} v${ver}: Windows DLL found!`);
            break;
          } else {
            console.log(
              `[PECL] ${extName} v${ver}: no DLL links (len=${windowsHtml.length})`
            );
          }
        } catch (e: any) {
          console.log(`[PECL] ${extName} v${ver}: fetch failed - ${e.message}`);
        }
      }

      if (versionsWithDll.length === 0) {
        console.log(`[PECL] ${extName}: no Windows DLL available`);
        return { available: false };
      }

      // Prefer stable version
      let targetVersion = versionsWithDll.find(
        (v) => !/RC|beta|alpha/i.test(v)
      );
      if (!targetVersion) {
        targetVersion = versionsWithDll[0];
      }

      console.log(`[PECL] ${extName}: selected version ${targetVersion}`);

      // 3. Get Windows DLL page and find download links
      const windowsUrl = `https://pecl.php.net/package/${extName}/${targetVersion}/windows`;
      console.log(`[PECL] ${extName}: fetching DLL list from ${windowsUrl}`);
      let windowsHtml = await this.fetchHtmlContent(windowsUrl);
      windowsHtml = this.decodeHtmlEntities(windowsHtml);

      // Extract all .zip download links
      const downloadLinkRegex = /href=["'](https?:\/\/[^"']*\.zip)["']/gi;
      const allLinks: string[] = [];
      while ((match = downloadLinkRegex.exec(windowsHtml)) !== null) {
        allLinks.push(match[1]);
      }

      console.log(`[PECL] ${extName}: found ${allLinks.length} download links`);

      // Find matching DLL for current PHP version
      // Format: php_redis-6.3.0-8.4-nts-vs17-x64.zip
      let matchedUrl: string | null = null;
      const compilers = [compiler, "vs17", "vs16", "vc15"];

      for (const url of allLinks) {
        const decodedUrl = decodeURIComponent(url).toLowerCase();

        // Check PHP version and thread safety
        for (const comp of compilers) {
          const pattern = `-${majorMinor}-${tsType}-${comp}-x64.zip`;
          if (decodedUrl.includes(pattern)) {
            matchedUrl = url;
            console.log(`[PECL] ${extName}: matched DLL ${url}`);
            break;
          }
        }
        if (matchedUrl) break;

        // Fallback: x86 version
        for (const comp of compilers) {
          const pattern = `-${majorMinor}-${tsType}-${comp}-x86.zip`;
          if (decodedUrl.includes(pattern)) {
            matchedUrl = url;
            console.log(`[PECL] ${extName}: matched x86 DLL ${url}`);
            break;
          }
        }
        if (matchedUrl) break;
      }

      if (matchedUrl) {
        return {
          available: true,
          extension: {
            name: extName,
            version: targetVersion,
            downloadUrl: matchedUrl,
            description: await this.getExtensionDescription(extName),
          },
          latestVersion: targetVersion,
        };
      }

      // Extract available PHP versions from download links
      const availablePhpVersions: string[] = [];
      for (const url of allLinks) {
        const versionMatch = url.match(/-(\d+\.\d+)-(nts|ts)-/i);
        if (versionMatch) {
          const phpVer = `${versionMatch[1]}-${versionMatch[2]}`;
          if (!availablePhpVersions.includes(phpVer)) {
            availablePhpVersions.push(phpVer);
          }
        }
      }

      // Sort by version descending
      availablePhpVersions.sort((a, b) => {
        const aVer = parseFloat(a.split("-")[0]);
        const bVer = parseFloat(b.split("-")[0]);
        return bVer - aVer;
      });

      console.log(
        `[PECL] ${extName} v${targetVersion}: available PHP versions [${availablePhpVersions.join(
          ", "
        )}]`
      );
      console.log(
        `[PECL] ${extName}: current PHP ${majorMinor}-${tsType} not matched`
      );

      return {
        available: false,
        supportedVersions: availablePhpVersions,
        latestVersion: targetVersion,
      };
    } catch (error: any) {
      console.error(`[PECL] ${extName}: error - ${error.message}`);
      return { available: false };
    }
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
      // Get latest version from PECL
      const packageUrl = `https://pecl.php.net/package/${peclExtName}`;
      console.log(`[PECL URL] ${peclExtName}: fetching ${packageUrl}`);
      let html = await this.fetchHtmlContent(packageUrl);

      console.log(`[PECL URL] ${peclExtName}: HTML length ${html.length}`);

      html = this.decodeHtmlEntities(html);

      // Find versions with DLL - format: /package/redis/6.3.0/windows
      const dllVersionRegex = /\/package\/[^\/]+\/([\d.]+(?:RC\d+)?)\/windows/g;
      const matches = html.match(dllVersionRegex);

      console.log(
        `[PECL URL] ${peclExtName}: found ${
          matches ? matches.length : 0
        } DLL links`
      );

      let latestVersion: string | null = null;
      if (matches && matches.length > 0) {
        const versionMatch = matches[0].match(/\/([\d.]+(?:RC\d+)?)\/windows/);
        if (versionMatch) {
          latestVersion = versionMatch[1];
        }
      }

      if (!latestVersion) {
        console.log(`[PECL URL] ${peclExtName}: no Windows DLL version found`);
        const anyVersionMatch = html.match(/\/package\/[^\/]+\/([\d.]+)["'>]/);
        if (anyVersionMatch) {
          latestVersion = anyVersionMatch[1];
          console.log(
            `[PECL URL] ${peclExtName}: trying version ${latestVersion}`
          );
        } else {
          return null;
        }
      }

      console.log(`[PECL URL] ${peclExtName}: found version ${latestVersion}`);

      // Build download URL
      const possibleUrls = [
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-${compiler}-x64.zip`,
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-${compiler}-x86.zip`,
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-vs16-x64.zip`,
        `https://downloads.php.net/~windows/pecl/releases/${peclExtName}/${latestVersion}/php_${peclExtName}-${latestVersion}-${majorMinor}-${tsType}-vc15-x64.zip`,
      ];

      // Check which URL exists
      for (const url of possibleUrls) {
        console.log(`[PECL URL] checking: ${url}`);
        const exists = await this.checkUrlExists(url);
        if (exists) {
          console.log(`[PECL URL] ${peclExtName}: found valid DLL ${url}`);
          return url;
        }
      }

      // Try parsing from Windows page
      const windowsUrl = `https://pecl.php.net/package/${peclExtName}/${latestVersion}/windows`;
      console.log(
        `[PECL URL] ${peclExtName}: checking Windows page ${windowsUrl}`
      );
      const windowsHtml = await this.fetchHtmlContent(windowsUrl);

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
            console.log(
              `[PECL URL] ${peclExtName}: found matching DLL from page ${url}`
            );
            return url;
          }
        }
      }

      console.log(
        `[PECL URL] ${peclExtName}: unable to build valid download URL`
      );
      return null;
    } catch (error: any) {
      console.error(`[PECL URL] ${peclExtName}: error - ${error.message}`);
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
   * 安装扩展（从 PECL 下载 DLL）
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
      const tempPath = this.configStore.getTempPath();

      if (!existsSync(extDir)) {
        return { success: false, message: "PHP 扩展目录不存在" };
      }

      // 获取 PHP 信息
      const phpInfo = await this.getPhpInfo(phpPath);
      if (!phpInfo) {
        return { success: false, message: "无法获取 PHP 版本信息" };
      }

      // 确定下载 URL
      let finalDownloadUrl = downloadUrl;
      const { majorMinor, isNts, compiler } = phpInfo;
      const tsType = isNts ? "nts" : "ts";

      if (!finalDownloadUrl) {
        // 从 PECL 获取最新版本和下载链接
        console.log(`[Install] ${extName}: fetching from PECL...`);
        const dllInfo = await this.fetchPeclDllInfo(
          extName,
          majorMinor,
          tsType,
          compiler
        );

        if (dllInfo.downloadUrl) {
          finalDownloadUrl = dllInfo.downloadUrl;
          console.log(
            `[Install] ${extName}: found v${dllInfo.version} for PHP ${majorMinor}`
          );
        } else {
          const supportedInfo = dllInfo.availablePhpVersions?.length
            ? `，支持的 PHP 版本: ${dllInfo.availablePhpVersions
                .slice(0, 5)
                .join(", ")}`
            : "";
          return {
            success: false,
            message: `未找到适用于 PHP ${majorMinor} ${tsType.toUpperCase()} 的 ${extName} 扩展 DLL${supportedInfo}`,
          };
        }
      }

      // 备用检查
      if (!finalDownloadUrl) {
        const peclResult = await this.getExtensionFromPeclWithInfo(
          extName,
          phpInfo
        );
        if (peclResult.available && peclResult.extension?.downloadUrl) {
          finalDownloadUrl = peclResult.extension.downloadUrl;
        } else {
          const supportedInfo = peclResult.supportedVersions?.length
            ? `, supported: ${peclResult.supportedVersions
                .slice(0, 3)
                .join(", ")}`
            : "";
          return {
            success: false,
            message: `未找到适用于 PHP ${phpInfo.majorMinor} ${
              phpInfo.isNts ? "NTS" : "TS"
            } 的 ${extName} 扩展${supportedInfo}`,
          };
        }
      }

      if (!finalDownloadUrl) {
        return { success: false, message: "未找到下载链接" };
      }

      console.log(`[Install] ${extName}: downloading from ${finalDownloadUrl}`);

      // Ensure temp directory exists
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true });
      }

      // Download extension ZIP
      const zipFileName = `php_${extName}.zip`;
      const zipPath = join(tempPath, zipFileName);

      await this.downloadExtension(finalDownloadUrl, zipPath);
      console.log(`[Install] ${extName}: download complete ${zipPath}`);

      // Extract to temp directory
      const extractPath = join(tempPath, `ext_${extName}`);
      if (existsSync(extractPath)) {
        this.removeDirectory(extractPath);
      }
      mkdirSync(extractPath, { recursive: true });

      await this.unzipFile(zipPath, extractPath);
      console.log(`[Install] ${extName}: extracted to ${extractPath}`);

      // Find and copy DLL files
      let dllCopied = false;
      const files = this.findFilesRecursive(extractPath, ".dll");

      for (const file of files) {
        const fileName = file.split(/[/\\]/).pop() || "";
        if (fileName.startsWith("php_") && fileName.endsWith(".dll")) {
          const destPath = join(extDir, fileName);
          const { copyFileSync } = require("fs");
          copyFileSync(file, destPath);
          console.log(
            `[Install] ${extName}: copied ${fileName} -> ${destPath}`
          );
          dllCopied = true;
        }
      }

      // Cleanup temp files
      if (existsSync(zipPath)) {
        unlinkSync(zipPath);
      }
      if (existsSync(extractPath)) {
        this.removeDirectory(extractPath);
      }

      if (!dllCopied) {
        return { success: false, message: "解压后未找到 DLL 文件" };
      }

      // Enable extension
      const enableResult = await this.enableExtension(version, extName);

      if (enableResult.success) {
        return {
          success: true,
          message: `${extName} 扩展安装成功并已启用，重启 PHP 后生效`,
        };
      } else {
        return {
          success: true,
          message: `${extName} 扩展 DLL 已安装，但启用失败: ${enableResult.message}。请手动在 php.ini 中添加 extension=${extName}`,
        };
      }
    } catch (error: any) {
      console.error(`[Install] ${extName}: error -`, error);
      return { success: false, message: `安装失败: ${error.message}` };
    }
  }

  /**
   * 递归查找文件
   */
  private findFilesRecursive(dir: string, extension: string): string[] {
    const results: string[] = [];

    if (!existsSync(dir)) {
      return results;
    }

    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        results.push(...this.findFilesRecursive(fullPath, extension));
      } else if (item.name.endsWith(extension)) {
        results.push(fullPath);
      }
    }

    return results;
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
   * 检查 URL 是否存在（使用 HEAD 请求快速检查）
   */
  private async checkUrlExists(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith("https") ? https : http;
      const urlObj = new URL(url);

      // 使用 HEAD 请求快速检查（比 GET 更快）
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "HEAD",
        timeout: 5000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      };

      const request = protocol.request(options, (response) => {
        // 处理重定向
        if (
          response.statusCode === 301 ||
          response.statusCode === 302 ||
          response.statusCode === 307
        ) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            // 绝对 URL 或相对 URL 处理
            const fullRedirectUrl = redirectUrl.startsWith("http")
              ? redirectUrl
              : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
            this.checkUrlExists(fullRedirectUrl).then(resolve);
            return;
          }
          resolve(true);
        } else {
          resolve(response.statusCode === 200);
        }
      });

      request.on("error", () => resolve(false));
      request.on("timeout", () => {
        request.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 获取 HTML 内容（支持 gzip 解压）
   */
  private async fetchHtmlContent(url: string): Promise<string> {
    const zlib = await import("zlib");

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;
      const request = protocol.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
            Connection: "keep-alive",
          },
          timeout: 20000,
        },
        (response) => {
          // 处理重定向
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307
          ) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              const fullUrl = redirectUrl.startsWith("http")
                ? redirectUrl
                : new URL(redirectUrl, url).href;
              this.fetchHtmlContent(fullUrl).then(resolve).catch(reject);
              return;
            }
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          const chunks: Buffer[] = [];

          // 根据 Content-Encoding 处理响应
          const encoding = response.headers["content-encoding"];
          let stream: NodeJS.ReadableStream = response;

          if (encoding === "gzip") {
            stream = response.pipe(zlib.createGunzip());
          } else if (encoding === "deflate") {
            stream = response.pipe(zlib.createInflate());
          }

          stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on("end", () => {
            const html = Buffer.concat(chunks).toString("utf-8");
            console.log(`[HTTP] ${url} - ${html.length} bytes`);
            resolve(html);
          });
          stream.on("error", reject);
        }
      );

      request.on("error", reject);
      request.on("timeout", () => {
        request.destroy();
        reject(new Error("Request timeout"));
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
    const composerBatPath = join(
      this.configStore.getBasePath(),
      "tools",
      "composer.bat"
    );
    const mirror = this.configStore.get("composerMirror") || "";

    console.log("[Composer] checking path:", composerPath);

    if (!existsSync(composerPath)) {
      console.log("[Composer] not installed");
      return { installed: false, mirror };
    }

    let version: string | undefined;

    // Method 1: Try composer.bat directly
    try {
      console.log("[Composer] trying composer --version...");
      const { stdout } = await execAsync("composer --version", {
        windowsHide: true,
        timeout: 15000,
        encoding: "utf8",
      });
      console.log("[Composer] output:", stdout);

      // 解析版本号 - 支持多种格式
      // "Composer version 2.9-dev+9497eca6e15b115d25833c68b7c5c76589953b65 (2.9-dev)"
      // "Composer version 2.7.1 2024-01-01"
      const versionMatch = stdout.match(
        /Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/
      );
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
        const versionMatch = stdout.match(
          /Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/
        );
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
          const { stdout } = await execAsync(
            `"${phpExe}" "${composerPath}" --version`,
            {
              windowsHide: true,
              timeout: 15000,
              encoding: "utf8",
            }
          );
          const versionMatch = stdout.match(
            /Composer version (\d+\.\d+(?:\.\d+)?(?:-\w+)?)/
          );
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
            const { stdout } = await execAsync(
              `"${phpExe}" "${composerPath}" --version`,
              {
                windowsHide: true,
                timeout: 10000,
              }
            );
            console.log("Composer 安装成功:", stdout);
          } catch (e) {
            console.log("Composer 已下载，但验证失败（可能是 PHP 问题）");
          }
        }
      }

      return {
        success: true,
        message: "Composer 安装成功，已添加到系统环境变量",
      };
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
      const tempScriptPath = join(
        this.configStore.getTempPath(),
        "add_composer_path.ps1"
      );
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
      const tempScriptPath = join(
        this.configStore.getTempPath(),
        "remove_composer_path.ps1"
      );
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
        return {
          success: false,
          message: "Composer 未安装，请先安装 Composer",
        };
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
          COMPOSER_HOME: join(
            this.configStore.getBasePath(),
            "tools",
            "composer"
          ),
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
