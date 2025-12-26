import { ConfigStore } from './ConfigStore'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'

export interface LogFile {
  name: string
  path: string
  size: number
  modifiedTime: Date
  type: 'nginx' | 'nginx-error' | 'nginx-access' | 'php' | 'mysql' | 'mysql-error' | 'site-access' | 'site-error'
}

export interface LogContent {
  content: string
  totalLines: number
  fileSize: number
}

export class LogManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取所有可用的日志文件列表
   */
  async getLogFiles(): Promise<{ nginx: LogFile[], php: LogFile[], mysql: LogFile[], sites: LogFile[] }> {
    const result = {
      nginx: [] as LogFile[],
      php: [] as LogFile[],
      mysql: [] as LogFile[],
      sites: [] as LogFile[]
    }

    // Nginx 日志
    const nginxPath = this.configStore.getNginxPath()
    const nginxLogsDir = join(nginxPath, 'logs')
    if (existsSync(nginxLogsDir)) {
      const files = this.scanLogDir(nginxLogsDir)
      for (const file of files) {
        if (file.name.includes('error')) {
          result.nginx.push({ ...file, type: 'nginx-error' })
        } else if (file.name.includes('access')) {
          result.nginx.push({ ...file, type: 'nginx-access' })
        } else {
          result.nginx.push({ ...file, type: 'nginx' })
        }
      }
    }

    // PHP 日志 - 检查每个 PHP 版本的日志
    const phpVersions = this.configStore.get('phpVersions') || []
    for (const version of phpVersions) {
      const phpPath = this.configStore.getPhpPath(version)
      const phpLogsDir = join(phpPath, 'logs')
      if (existsSync(phpLogsDir)) {
        const files = this.scanLogDir(phpLogsDir)
        for (const file of files) {
          result.php.push({ ...file, type: 'php', name: `[${version}] ${file.name}` })
        }
      }
      // 也检查 php.ini 中配置的 error_log
      const phpErrorLog = join(phpPath, 'php_errors.log')
      if (existsSync(phpErrorLog)) {
        const stat = statSync(phpErrorLog)
        result.php.push({
          name: `[${version}] php_errors.log`,
          path: phpErrorLog,
          size: stat.size,
          modifiedTime: stat.mtime,
          type: 'php'
        })
      }
    }

    // MySQL 日志
    const mysqlVersions = this.configStore.get('mysqlVersions') || []
    for (const version of mysqlVersions) {
      const mysqlPath = this.configStore.getMysqlPath(version)
      // MySQL 日志通常在 data 目录下
      const mysqlDataDir = join(mysqlPath, 'data')
      if (existsSync(mysqlDataDir)) {
        const files = readdirSync(mysqlDataDir)
        for (const file of files) {
          if (file.endsWith('.err') || file.endsWith('.log')) {
            const filePath = join(mysqlDataDir, file)
            const stat = statSync(filePath)
            const logType = file.includes('error') || file.endsWith('.err') ? 'mysql-error' : 'mysql'
            result.mysql.push({
              name: `[${version}] ${file}`,
              path: filePath,
              size: stat.size,
              modifiedTime: stat.mtime,
              type: logType
            })
          }
        }
      }
      // 也检查 logs 目录
      const mysqlLogsDir = join(mysqlPath, 'logs')
      if (existsSync(mysqlLogsDir)) {
        const files = this.scanLogDir(mysqlLogsDir)
        for (const file of files) {
          result.mysql.push({ ...file, type: 'mysql', name: `[${version}] ${file.name}` })
        }
      }
    }

    // 站点日志 - Nginx sites logs
    const sites = this.configStore.get('sites') || []
    for (const site of sites) {
      // 站点日志通常在 nginx/logs 目录下，以域名命名
      const siteAccessLog = join(nginxLogsDir, `${site.domain}.access.log`)
      const siteErrorLog = join(nginxLogsDir, `${site.domain}.error.log`)
      
      if (existsSync(siteAccessLog)) {
        const stat = statSync(siteAccessLog)
        result.sites.push({
          name: `${site.domain} - 访问日志`,
          path: siteAccessLog,
          size: stat.size,
          modifiedTime: stat.mtime,
          type: 'site-access'
        })
      }
      
      if (existsSync(siteErrorLog)) {
        const stat = statSync(siteErrorLog)
        result.sites.push({
          name: `${site.domain} - 错误日志`,
          path: siteErrorLog,
          size: stat.size,
          modifiedTime: stat.mtime,
          type: 'site-error'
        })
      }
    }

    return result
  }

  /**
   * 读取日志文件内容
   * @param logPath 日志文件路径
   * @param lines 读取的行数（从末尾开始），默认 500 行
   */
  async readLog(logPath: string, lines: number = 500): Promise<LogContent> {
    if (!existsSync(logPath)) {
      return { content: '日志文件不存在', totalLines: 0, fileSize: 0 }
    }

    try {
      const stat = statSync(logPath)
      const fileSize = stat.size

      // 如果文件小于 1MB，直接读取全部内容
      if (fileSize < 1024 * 1024) {
        const content = readFileSync(logPath, 'utf-8')
        const allLines = content.split('\n')
        const totalLines = allLines.length

        // 取最后 N 行
        const lastLines = allLines.slice(-lines).join('\n')
        return { content: lastLines, totalLines, fileSize }
      }

      // 大文件：从末尾读取
      const content = await this.readLastLines(logPath, lines)
      return { content, totalLines: lines, fileSize }
    } catch (error: any) {
      return { content: `读取日志失败: ${error.message}`, totalLines: 0, fileSize: 0 }
    }
  }

  /**
   * 从文件末尾读取指定行数
   */
  private async readLastLines(filePath: string, lines: number): Promise<string> {
    const fs = await import('fs/promises')
    const stat = await fs.stat(filePath)
    const fileSize = stat.size

    // 估算需要读取的字节数（假设每行约 200 字节）
    const bytesToRead = Math.min(fileSize, lines * 200)
    const startPosition = Math.max(0, fileSize - bytesToRead)

    const buffer = Buffer.alloc(bytesToRead)
    const fd = await fs.open(filePath, 'r')
    await fd.read(buffer, 0, bytesToRead, startPosition)
    await fd.close()

    const content = buffer.toString('utf-8')
    const allLines = content.split('\n')
    
    // 第一行可能不完整，跳过
    const completeLines = startPosition === 0 ? allLines : allLines.slice(1)
    
    return completeLines.slice(-lines).join('\n')
  }

  /**
   * 清空日志文件
   */
  async clearLog(logPath: string): Promise<{ success: boolean, message: string }> {
    if (!existsSync(logPath)) {
      return { success: false, message: '日志文件不存在' }
    }

    try {
      const fs = await import('fs/promises')
      await fs.writeFile(logPath, '')
      return { success: true, message: '日志已清空' }
    } catch (error: any) {
      return { success: false, message: `清空日志失败: ${error.message}` }
    }
  }

  /**
   * 扫描目录中的日志文件
   */
  private scanLogDir(dir: string): LogFile[] {
    const files: LogFile[] = []

    if (!existsSync(dir)) {
      return files
    }

    try {
      const items = readdirSync(dir)
      for (const item of items) {
        const filePath = join(dir, item)
        const stat = statSync(filePath)
        
        if (stat.isFile() && (item.endsWith('.log') || item.endsWith('.err'))) {
          files.push({
            name: item,
            path: filePath,
            size: stat.size,
            modifiedTime: stat.mtime,
            type: 'nginx' // 默认类型，调用方会覆盖
          })
        }
      }
    } catch (error) {
      console.error('扫描日志目录失败:', error)
    }

    return files.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
  }

  /**
   * 获取日志文件路径（用于在文件管理器中打开）
   */
  getLogDirectory(type: 'nginx' | 'php' | 'mysql' | 'sites', version?: string): string {
    switch (type) {
      case 'nginx':
        return join(this.configStore.getNginxPath(), 'logs')
      case 'php':
        if (version) {
          return join(this.configStore.getPhpPath(version), 'logs')
        }
        return join(this.configStore.getBasePath(), 'php')
      case 'mysql':
        if (version) {
          return join(this.configStore.getMysqlPath(version), 'data')
        }
        return join(this.configStore.getBasePath(), 'mysql')
      case 'sites':
        return join(this.configStore.getNginxPath(), 'logs')
      default:
        return this.configStore.getBasePath()
    }
  }
}

