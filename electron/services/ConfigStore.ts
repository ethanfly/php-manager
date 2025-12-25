import Store from 'electron-store'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'

interface ConfigSchema {
  basePath: string
  phpVersions: string[]
  mysqlVersions: string[]
  nginxVersions: string[]
  redisVersions: string[]
  activePhpVersion: string
  autoStart: {
    nginx: boolean
    mysql: boolean
    redis: boolean
  }
  sites: SiteConfig[]
}

export interface SiteConfig {
  name: string
  domain: string
  rootPath: string
  phpVersion: string
  isLaravel: boolean
  ssl: boolean
  enabled: boolean
}

// 获取应用安装目录下的 data 路径
function getDefaultBasePath(): string {
  if (app.isPackaged) {
    // 生产环境：使用可执行文件所在目录下的 data 文件夹
    const exePath = app.getPath('exe')
    const appDir = dirname(exePath)
    return join(appDir, 'data')
  } else {
    // 开发环境：使用项目根目录下的 data 文件夹
    return join(process.cwd(), 'data')
  }
}

export class ConfigStore {
  private store: Store<ConfigSchema>
  private basePath: string

  constructor() {
    this.store = new Store<ConfigSchema>({
      defaults: {
        basePath: getDefaultBasePath(),
        phpVersions: [],
        mysqlVersions: [],
        nginxVersions: [],
        redisVersions: [],
        activePhpVersion: '',
        autoStart: {
          nginx: false,
          mysql: false,
          redis: false
        },
        sites: []
      }
    })

    this.basePath = this.store.get('basePath')
    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    const dirs = [
      this.basePath,
      join(this.basePath, 'php'),
      join(this.basePath, 'mysql'),
      join(this.basePath, 'nginx'),
      join(this.basePath, 'nginx', 'sites-available'),
      join(this.basePath, 'nginx', 'sites-enabled'),
      join(this.basePath, 'nginx', 'ssl'),
      join(this.basePath, 'redis'),
      join(this.basePath, 'logs'),
      join(this.basePath, 'temp'),
      join(this.basePath, 'www')
    ]

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    return this.store.get(key)
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.store.set(key, value)
  }

  getBasePath(): string {
    return this.basePath
  }

  setBasePath(path: string): void {
    this.basePath = path
    this.store.set('basePath', path)
    this.ensureDirectories()
  }

  getPhpPath(version: string): string {
    return join(this.basePath, 'php', `php-${version}`)
  }

  getMysqlPath(version: string): string {
    return join(this.basePath, 'mysql', `mysql-${version}`)
  }

  getNginxPath(): string {
    return join(this.basePath, 'nginx')
  }

  getRedisPath(): string {
    return join(this.basePath, 'redis')
  }

  getNodePath(): string {
    return join(this.basePath, 'nodejs')
  }

  getLogsPath(): string {
    return join(this.basePath, 'logs')
  }

  getTempPath(): string {
    return join(this.basePath, 'temp')
  }

  getWwwPath(): string {
    return join(this.basePath, 'www')
  }

  getSitesAvailablePath(): string {
    return join(this.basePath, 'nginx', 'sites-available')
  }

  getSitesEnabledPath(): string {
    return join(this.basePath, 'nginx', 'sites-enabled')
  }

  getSSLPath(): string {
    return join(this.basePath, 'nginx', 'ssl')
  }

  addPhpVersion(version: string): void {
    const versions = this.store.get('phpVersions')
    if (!versions.includes(version)) {
      versions.push(version)
      this.store.set('phpVersions', versions)
    }
  }

  removePhpVersion(version: string): void {
    const versions = this.store.get('phpVersions')
    const index = versions.indexOf(version)
    if (index > -1) {
      versions.splice(index, 1)
      this.store.set('phpVersions', versions)
    }
  }

  addMysqlVersion(version: string): void {
    const versions = this.store.get('mysqlVersions')
    if (!versions.includes(version)) {
      versions.push(version)
      this.store.set('mysqlVersions', versions)
    }
  }

  removeMysqlVersion(version: string): void {
    const versions = this.store.get('mysqlVersions')
    const index = versions.indexOf(version)
    if (index > -1) {
      versions.splice(index, 1)
      this.store.set('mysqlVersions', versions)
    }
  }

  addSite(site: SiteConfig): void {
    const sites = this.store.get('sites')
    sites.push(site)
    this.store.set('sites', sites)
  }

  removeSite(name: string): void {
    const sites = this.store.get('sites')
    const index = sites.findIndex(s => s.name === name)
    if (index > -1) {
      sites.splice(index, 1)
      this.store.set('sites', sites)
    }
  }

  updateSite(name: string, site: Partial<SiteConfig>): void {
    const sites = this.store.get('sites')
    const index = sites.findIndex(s => s.name === name)
    if (index > -1) {
      // 如果传入完整对象则替换，否则合并
      if (site.domain && site.rootPath) {
        sites[index] = site as SiteConfig
      } else {
        sites[index] = { ...sites[index], ...site }
      }
      this.store.set('sites', sites)
    }
  }

  getSites(): SiteConfig[] {
    return this.store.get('sites')
  }
}

