import { ConfigStore } from './ConfigStore'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import { sendDownloadProgress } from '../main'

const execAsync = promisify(exec)

interface RedisVersion {
  version: string
  path: string
  isRunning: boolean
}

interface AvailableRedisVersion {
  version: string
  downloadUrl: string
}

interface RedisStatus {
  running: boolean
  pid?: number
  port?: number
  memory?: string
}

export class RedisManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取已安装的 Redis 版本列表
   */
  async getInstalledVersions(): Promise<RedisVersion[]> {
    const versions: RedisVersion[] = []
    const redisPath = this.configStore.getRedisPath()

    if (!existsSync(redisPath)) {
      return versions
    }

    // 检查是否存在 redis-server.exe
    if (existsSync(join(redisPath, 'redis-server.exe'))) {
      try {
        // 尝试获取版本
        const { stdout } = await execAsync(`"${join(redisPath, 'redis-server.exe')}" --version`)
        const match = stdout.match(/v=(\d+\.\d+\.\d+)/)
        if (match) {
          const isRunning = await this.checkIsRunning()
          versions.push({
            version: match[1],
            path: redisPath,
            isRunning
          })
        }
      } catch (error) {
        // 默认版本
        const isRunning = await this.checkIsRunning()
        versions.push({
          version: 'unknown',
          path: redisPath,
          isRunning
        })
      }
    }

    return versions
  }

  // 缓存版本列表
  private versionCache: { versions: AvailableRedisVersion[]; timestamp: number } | null = null
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

  /**
   * 获取可用的 Redis 版本列表（Windows 版本）
   * 动态从 GitHub releases 获取
   */
  async getAvailableVersions(): Promise<AvailableRedisVersion[]> {
    // 检查缓存
    if (this.versionCache && (Date.now() - this.versionCache.timestamp) < this.CACHE_TTL) {
      console.log('使用缓存的 Redis 版本列表')
      return this.versionCache.versions
    }

    let versions: AvailableRedisVersion[] = []

    try {
      // 从 redis-windows GitHub releases 获取版本列表
      console.log('从 GitHub 获取 Redis Windows 版本列表...')
      const releases = await this.fetchGitHubReleases('redis-windows', 'redis-windows')
      
      for (const release of releases) {
        const version = release.tag_name.replace(/^v/, '')
        
        // 查找 Windows x64 ZIP 文件
        const asset = release.assets?.find((a: any) => 
          a.name.includes('Windows-x64') && a.name.endsWith('.zip')
        )
        
        if (asset) {
          versions.push({
            version,
            downloadUrl: asset.browser_download_url
          })
        }
      }

      console.log(`从 GitHub 获取到 ${versions.length} 个 Redis 版本`)
    } catch (error: any) {
      console.error('从 GitHub 获取 Redis 版本失败:', error.message)
    }

    // 如果获取失败或为空，使用备用列表
    if (versions.length === 0) {
      console.log('使用备用 Redis 版本列表')
      versions = this.getFallbackVersions()
    }

    // 更新缓存
    this.versionCache = { versions, timestamp: Date.now() }

    return versions
  }

  /**
   * 从 GitHub API 获取 releases
   */
  private async fetchGitHubReleases(owner: string, repo: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases?per_page=20`,
        method: 'GET',
        headers: {
          'User-Agent': 'PHPer-Dev-Manager',
          'Accept': 'application/vnd.github.v3+json'
        }
      }

      const request = https.request(options, (response) => {
        let data = ''
        response.on('data', chunk => data += chunk)
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              resolve(JSON.parse(data))
            } else {
              reject(new Error(`GitHub API 返回 ${response.statusCode}`))
            }
          } catch (e) {
            reject(e)
          }
        })
      })

      request.on('error', reject)
      request.setTimeout(15000, () => {
        request.destroy()
        reject(new Error('请求超时'))
      })
      request.end()
    })
  }

  /**
   * 备用版本列表
   */
  private getFallbackVersions(): AvailableRedisVersion[] {
    return [
      {
        version: '7.4.2',
        downloadUrl: 'https://github.com/redis-windows/redis-windows/releases/download/7.4.2/Redis-7.4.2-Windows-x64.zip'
      },
      {
        version: '7.2.7',
        downloadUrl: 'https://github.com/redis-windows/redis-windows/releases/download/7.2.7/Redis-7.2.7-Windows-x64.zip'
      },
      {
        version: '7.0.15',
        downloadUrl: 'https://github.com/redis-windows/redis-windows/releases/download/7.0.15/Redis-7.0.15-Windows-x64.zip'
      },
      {
        version: '6.2.16',
        downloadUrl: 'https://github.com/redis-windows/redis-windows/releases/download/6.2.16/Redis-6.2.16-Windows-x64.zip'
      }
    ]
  }

  /**
   * 安装 Redis 版本
   */
  async install(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions()
      const versionInfo = available.find(v => v.version === version)
      
      if (!versionInfo) {
        return { success: false, message: `未找到 Redis ${version} 版本` }
      }

      const redisPath = this.configStore.getRedisPath()
      const tempPath = this.configStore.getTempPath()
      const zipPath = join(tempPath, `redis-${version}.zip`)

      // 如果已有 Redis，先备份配置
      let oldConfig = ''
      const configPath = join(redisPath, 'redis.windows.conf')
      if (existsSync(configPath)) {
        oldConfig = readFileSync(configPath, 'utf-8')
      }

      // 下载 Redis
      await this.downloadFile(versionInfo.downloadUrl, zipPath)

      // 清理旧版本（保留配置）
      if (existsSync(redisPath)) {
        const files = readdirSync(redisPath, { withFileTypes: true })
        for (const file of files) {
          if (!file.name.endsWith('.conf')) {
            const fullPath = join(redisPath, file.name)
            if (file.isDirectory()) {
              this.removeDirectory(fullPath)
            } else {
              unlinkSync(fullPath)
            }
          }
        }
      } else {
        mkdirSync(redisPath, { recursive: true })
      }

      // 解压
      await this.unzip(zipPath, redisPath)

      // 删除临时文件
      if (existsSync(zipPath)) {
        unlinkSync(zipPath)
      }

      // 移动解压后的文件（某些版本解压后有子目录）
      await this.flattenDirectory(redisPath)

      // 恢复或创建配置
      if (oldConfig) {
        writeFileSync(configPath, oldConfig)
      } else {
        await this.createDefaultConfig()
      }

      return { success: true, message: `Redis ${version} 安装成功` }
    } catch (error: any) {
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 Redis
   */
  async uninstall(version: string): Promise<{ success: boolean; message: string }> {
    try {
      // 先停止服务
      await this.stop()

      const redisPath = this.configStore.getRedisPath()
      
      if (!existsSync(redisPath)) {
        return { success: false, message: 'Redis 未安装' }
      }

      // 递归删除目录
      this.removeDirectory(redisPath)

      return { success: true, message: 'Redis 已卸载' }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 启动 Redis
   */
  async start(): Promise<{ success: boolean; message: string }> {
    try {
      const redisPath = this.configStore.getRedisPath()
      const redisServer = join(redisPath, 'redis-server.exe')
      const configPath = join(redisPath, 'redis.windows.conf')

      if (!existsSync(redisServer)) {
        return { success: false, message: 'Redis 未安装' }
      }

      // 检查是否已在运行
      const isRunning = await this.checkIsRunning()
      if (isRunning) {
        return { success: true, message: 'Redis 已经在运行' }
      }

      // 确保配置文件存在
      if (!existsSync(configPath)) {
        await this.createDefaultConfig()
      }

      // 使用 VBScript 静默启动 Redis（避免黑窗口闪烁）
      const configFileName = 'redis.windows.conf'
      const vbsPath = join(redisPath, 'start_redis.vbs')
      const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.CurrentDirectory = "${redisPath.replace(/\\/g, '\\\\')}"\nWshShell.Run """${redisServer.replace(/\\/g, '\\\\')}""" & " " & "${configFileName}", 0, False`
      writeFileSync(vbsPath, vbsContent)
      
      const child = spawn('wscript.exe', [vbsPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()

      // 等待启动
      await new Promise(resolve => setTimeout(resolve, 2000))

      const running = await this.checkIsRunning()
      if (running) {
        return { success: true, message: 'Redis 启动成功' }
      } else {
        // 检查日志获取错误信息
        const logsPath = this.configStore.getLogsPath()
        const logFile = join(logsPath, 'redis.log')
        let errorInfo = ''
        if (existsSync(logFile)) {
          try {
            const logContent = readFileSync(logFile, 'utf-8')
            const lines = logContent.split('\n').slice(-10)
            errorInfo = '\n日志: ' + lines.join('\n')
          } catch (e) {}
        }
        return { success: false, message: 'Redis 启动失败，请检查配置' + errorInfo }
      }
    } catch (error: any) {
      return { success: false, message: `启动失败: ${error.message}` }
    }
  }

  /**
   * 停止 Redis
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    try {
      const redisPath = this.configStore.getRedisPath()
      const redisCli = join(redisPath, 'redis-cli.exe')

      if (existsSync(redisCli)) {
        try {
          await execAsync(`"${redisCli}" shutdown`, { timeout: 10000 })
        } catch (e) {
          // 尝试强制结束
          try {
            await execAsync('taskkill /F /IM redis-server.exe', { timeout: 5000 })
          } catch (e2) {
            // 进程可能不存在
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000))

      const isRunning = await this.checkIsRunning()
      if (!isRunning) {
        return { success: true, message: 'Redis 已停止' }
      } else {
        return { success: false, message: 'Redis 停止失败' }
      }
    } catch (error: any) {
      return { success: false, message: `停止失败: ${error.message}` }
    }
  }

  /**
   * 重启 Redis
   */
  async restart(): Promise<{ success: boolean; message: string }> {
    await this.stop()
    await new Promise(resolve => setTimeout(resolve, 500))
    return await this.start()
  }

  /**
   * 获取 Redis 状态
   */
  async getStatus(): Promise<RedisStatus> {
    const isRunning = await this.checkIsRunning()
    
    if (!isRunning) {
      return { running: false }
    }

    try {
      const redisPath = this.configStore.getRedisPath()
      const redisCli = join(redisPath, 'redis-cli.exe')
      
      if (existsSync(redisCli)) {
        const { stdout } = await execAsync(`"${redisCli}" INFO server`, { timeout: 5000 })
        
        const portMatch = stdout.match(/tcp_port:(\d+)/)
        const memMatch = stdout.match(/used_memory_human:(\S+)/)
        
        // 获取 PID
        const { stdout: taskOutput } = await execAsync('tasklist /FI "IMAGENAME eq redis-server.exe" /FO CSV /NH')
        let pid: number | undefined
        if (taskOutput.includes('redis-server.exe')) {
          const parts = taskOutput.split(',')
          pid = parseInt(parts[1].replace(/"/g, ''))
        }

        return {
          running: true,
          pid,
          port: portMatch ? parseInt(portMatch[1]) : 6379,
          memory: memMatch ? memMatch[1] : undefined
        }
      }
    } catch (e) {
      // 忽略错误
    }

    return { running: isRunning }
  }

  /**
   * 获取 Redis 配置内容
   */
  async getConfig(): Promise<string> {
    const redisPath = this.configStore.getRedisPath()
    const configPath = join(redisPath, 'redis.windows.conf')
    
    if (!existsSync(configPath)) {
      return ''
    }

    return readFileSync(configPath, 'utf-8')
  }

  /**
   * 保存 Redis 配置
   */
  async saveConfig(config: string): Promise<{ success: boolean; message: string }> {
    try {
      const redisPath = this.configStore.getRedisPath()
      const configPath = join(redisPath, 'redis.windows.conf')
      
      writeFileSync(configPath, config)
      return { success: true, message: 'redis.windows.conf 保存成功，需要重启 Redis 生效' }
    } catch (error: any) {
      return { success: false, message: `保存失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  private async checkIsRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq redis-server.exe" /FO CSV /NH')
      return stdout.includes('redis-server.exe')
    } catch (e) {
      return false
    }
  }

  /**
   * 将 Windows 路径转换为 Cygwin 路径
   */
  private toCygwinPath(winPath: string): string {
    // C:\Users\... -> /cygdrive/c/Users/...
    const match = winPath.match(/^([A-Za-z]):[\\\/](.*)$/)
    if (match) {
      const drive = match[1].toLowerCase()
      const rest = match[2].replace(/\\/g, '/')
      return `/cygdrive/${drive}/${rest}`
    }
    return winPath.replace(/\\/g, '/')
  }

  private async createDefaultConfig(): Promise<void> {
    const redisPath = this.configStore.getRedisPath()
    const configPath = join(redisPath, 'redis.windows.conf')
    const logsPath = this.configStore.getLogsPath()

    // 确保日志目录存在
    if (!existsSync(logsPath)) {
      mkdirSync(logsPath, { recursive: true })
    }

    // 转换为 Cygwin 路径格式
    const cygwinLogsPath = this.toCygwinPath(logsPath)
    const cygwinRedisPath = this.toCygwinPath(redisPath)

    // 检查是否有示例配置文件
    const sampleConfig = join(redisPath, 'redis.windows-service.conf')
    if (existsSync(sampleConfig)) {
      let config = readFileSync(sampleConfig, 'utf-8')
      
      // 修改一些配置
      config = config.replace(/^# bind 127.0.0.1/m, 'bind 127.0.0.1')
      config = config.replace(/^logfile ""/m, `logfile "${cygwinLogsPath}/redis.log"`)
      
      writeFileSync(configPath, config)
      return
    }

    // 创建基本配置（使用 Cygwin 路径格式）
    const config = `# Redis Configuration File

# Bind address
bind 127.0.0.1

# Port
port 6379

# Log file (Cygwin path format)
logfile "${cygwinLogsPath}/redis.log"

# Log level
loglevel notice

# Number of databases
databases 16

# Persistence
save 900 1
save 300 10
save 60 10000

# Data file
dbfilename dump.rdb
dir "${cygwinRedisPath}"

# Max memory
maxmemory 256mb
maxmemory-policy allkeys-lru

# Timeout
timeout 0
tcp-keepalive 300

# Protected mode
protected-mode yes
`

    writeFileSync(configPath, config)
  }

  private async flattenDirectory(dir: string): Promise<void> {
    const items = readdirSync(dir, { withFileTypes: true })
    
    // 检查是否只有一个子目录
    const subdirs = items.filter(item => item.isDirectory())
    if (subdirs.length === 1 && items.filter(item => !item.isDirectory()).length === 0) {
      const subdir = join(dir, subdirs[0].name)
      const subItems = readdirSync(subdir)
      
      const { rename } = await import('fs/promises')
      
      // 移动子目录中的所有文件到父目录
      for (const item of subItems) {
        const srcPath = join(subdir, item)
        const destPath = join(dir, item)
        await rename(srcPath, destPath)
      }
      
      // 删除空的子目录
      rmdirSync(subdir)
    }
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest)
      const protocol = url.startsWith('https') ? https : http

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            if (existsSync(dest)) unlinkSync(dest)
            this.downloadFile(redirectUrl, dest).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`下载失败，状态码: ${response.statusCode}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0
        let lastProgressTime = Date.now()

        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          const now = Date.now()
          if (now - lastProgressTime > 500) {
            const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
            sendDownloadProgress('redis', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          sendDownloadProgress('redis', 100, totalSize, totalSize)
          resolve()
        })
      })

      request.on('error', (err) => {
        file.close()
        if (existsSync(dest)) unlinkSync(dest)
        reject(err)
      })

      request.setTimeout(300000, () => {
        request.destroy()
        reject(new Error('下载超时'))
      })
    })
  }

  private async unzip(zipPath: string, destPath: string): Promise<void> {
    const { createReadStream } = await import('fs')
    const unzipper = await import('unzipper')
    
    return new Promise((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destPath }))
        .on('close', resolve)
        .on('error', reject)
    })
  }

  private removeDirectory(dir: string): void {
    if (existsSync(dir)) {
      const files = readdirSync(dir, { withFileTypes: true })
      for (const file of files) {
        const fullPath = join(dir, file.name)
        if (file.isDirectory()) {
          this.removeDirectory(fullPath)
        } else {
          unlinkSync(fullPath)
        }
      }
      rmdirSync(dir)
    }
  }
}

