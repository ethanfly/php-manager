import Store from "electron-store";
import { join, dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { app } from "electron";

interface ConfigSchema {
  basePath: string;
  phpVersions: string[];
  mysqlVersions: string[];
  nginxVersions: string[];
  redisVersions: string[];
  nodeVersions: string[];
  goVersions: string[];
  activePhpVersion: string;
  activeNodeVersion: string;
  activeGoVersion: string;
  autoStart: {
    nginx: boolean;
    mysql: boolean;
    redis: boolean;
  };
  sites: SiteConfig[];
  // 应用设置
  autoLaunch: boolean;
  startMinimized: boolean;
  // Composer 设置
  composerMirror: string;
}

export interface SiteConfig {
  name: string;
  domain: string;
  rootPath: string;
  phpVersion: string;
  isLaravel: boolean;
  ssl: boolean;
  enabled: boolean;
  // 反向代理配置
  isProxy?: boolean;
  proxyTarget?: string; // 代理目标地址，如 http://127.0.0.1:3000
}

// 获取与应用安装目录平级的 service 路径
function getDefaultBasePath(): string {
  if (app.isPackaged) {
    // 生产环境：使用与应用安装目录平级的 service 文件夹
    // 例如：app 在 C:\DevTools\PHPer开发环境管理器\，service 在 C:\DevTools\service\
    const exePath = app.getPath("exe");
    const appDir = dirname(exePath);
    const parentDir = dirname(appDir);
    return join(parentDir, "service");
  } else {
    // 开发环境：使用项目根目录下的 service 文件夹
    return join(process.cwd(), "service");
  }
}

export class ConfigStore {
  private store: Store<ConfigSchema>;
  private basePath: string;

  constructor() {
    this.store = new Store<ConfigSchema>({
      defaults: {
        basePath: "",
        phpVersions: [],
        mysqlVersions: [],
        nginxVersions: [],
        redisVersions: [],
        nodeVersions: [],
        goVersions: [],
        activePhpVersion: "",
        activeNodeVersion: "",
        activeGoVersion: "",
        autoStart: {
          nginx: false,
          mysql: false,
          redis: false,
        },
        sites: [],
        // 应用设置默认值
        autoLaunch: false,
        startMinimized: false,
        // Composer 镜像（空为官方源）
        composerMirror: "",
      },
    });

    // 使用与应用安装目录平级的 service 路径
    this.basePath = getDefaultBasePath();
    this.store.set("basePath", this.basePath);
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.basePath,
      join(this.basePath, "php"),
      join(this.basePath, "mysql"),
      join(this.basePath, "nginx"),
      join(this.basePath, "nginx", "sites-available"),
      join(this.basePath, "nginx", "sites-enabled"),
      join(this.basePath, "nginx", "ssl"),
      join(this.basePath, "redis"),
      join(this.basePath, "nodejs"),
      join(this.basePath, "go"),
      join(this.basePath, "logs"),
      join(this.basePath, "temp"),
      join(this.basePath, "www"),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    return this.store.get(key);
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.store.set(key, value);
  }

  getBasePath(): string {
    return this.basePath;
  }

  setBasePath(path: string): void {
    this.basePath = path;
    this.store.set("basePath", path);
    this.ensureDirectories();
  }

  getPhpPath(version: string): string {
    return join(this.basePath, "php", `php-${version}`);
  }

  getMysqlPath(version: string): string {
    return join(this.basePath, "mysql", `mysql-${version}`);
  }

  getNginxPath(): string {
    return join(this.basePath, "nginx");
  }

  getRedisPath(): string {
    return join(this.basePath, "redis");
  }

  getNodePath(): string {
    return join(this.basePath, "nodejs");
  }

  getGoPath(): string {
    return join(this.basePath, "go");
  }

  getLogsPath(): string {
    return join(this.basePath, "logs");
  }

  getTempPath(): string {
    return join(this.basePath, "temp");
  }

  getWwwPath(): string {
    return join(this.basePath, "www");
  }

  getSitesAvailablePath(): string {
    return join(this.basePath, "nginx", "sites-available");
  }

  getSitesEnabledPath(): string {
    return join(this.basePath, "nginx", "sites-enabled");
  }

  getSSLPath(): string {
    return join(this.basePath, "nginx", "ssl");
  }

  addPhpVersion(version: string): void {
    const versions = this.store.get("phpVersions");
    if (!versions.includes(version)) {
      versions.push(version);
      this.store.set("phpVersions", versions);
    }
  }

  removePhpVersion(version: string): void {
    const versions = this.store.get("phpVersions");
    const index = versions.indexOf(version);
    if (index > -1) {
      versions.splice(index, 1);
      this.store.set("phpVersions", versions);
    }
  }

  addMysqlVersion(version: string): void {
    const versions = this.store.get("mysqlVersions");
    if (!versions.includes(version)) {
      versions.push(version);
      this.store.set("mysqlVersions", versions);
    }
  }

  removeMysqlVersion(version: string): void {
    const versions = this.store.get("mysqlVersions");
    const index = versions.indexOf(version);
    if (index > -1) {
      versions.splice(index, 1);
      this.store.set("mysqlVersions", versions);
    }
  }

  addSite(site: SiteConfig): void {
    const sites = this.store.get("sites");
    sites.push(site);
    this.store.set("sites", sites);
  }

  removeSite(name: string): void {
    const sites = this.store.get("sites");
    const index = sites.findIndex((s) => s.name === name);
    if (index > -1) {
      sites.splice(index, 1);
      this.store.set("sites", sites);
    }
  }

  updateSite(name: string, site: Partial<SiteConfig>): void {
    const sites = this.store.get("sites");
    const index = sites.findIndex((s) => s.name === name);
    if (index > -1) {
      // 如果传入完整对象则替换，否则合并
      if (site.domain && site.rootPath) {
        sites[index] = site as SiteConfig;
      } else {
        sites[index] = { ...sites[index], ...site };
      }
      this.store.set("sites", sites);
    }
  }

  getSites(): SiteConfig[] {
    return this.store.get("sites");
  }
}
