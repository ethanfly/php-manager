import { ConfigStore } from './ConfigStore'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import { sendDownloadProgress } from '../main'

const execAsync = promisify(exec)

interface MysqlVersion {
  version: string
  path: string
  isRunning: boolean
}

interface AvailableMysqlVersion {
  version: string
  downloadUrl: string
  mirrors?: string[]  // 备用下载链接
}

// 阿里云镜像基础地址
const ALIYUN_MIRROR_BASE = 'https://mirrors.aliyun.com/mysql/'
// 搜狐镜像作为备用
const SOHU_MIRROR_BASE = 'https://mirrors.sohu.com/mysql/'

export class MysqlManager {
  private configStore: ConfigStore
  private mysqlProcess: any = null
  private cachedVersions: AvailableMysqlVersion[] | null = null
  private cacheTime: number = 0
  private readonly CACHE_DURATION = 5 * 60 * 1000  // 缓存5分钟

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取已安装的 MySQL 版本列表
   */
  async getInstalledVersions(): Promise<MysqlVersion[]> {
    const versions: MysqlVersion[] = []
    const mysqlDir = join(this.configStore.getBasePath(), 'mysql')

    if (!existsSync(mysqlDir)) {
      return versions
    }

    const dirs = readdirSync(mysqlDir, { withFileTypes: true })
    for (const dir of dirs) {
      if (dir.isDirectory() && dir.name.startsWith('mysql-')) {
        const version = dir.name.replace('mysql-', '')
        const mysqlPath = join(mysqlDir, dir.name)
        
        // 验证 MySQL 是否真的存在
        if (existsSync(join(mysqlPath, 'bin', 'mysqld.exe'))) {
          const isRunning = await this.checkIsRunning(version)
          versions.push({
            version,
            path: mysqlPath,
            isRunning
          })
        }
      }
    }

    return versions.sort((a, b) => b.version.localeCompare(a.version))
  }

  /**
   * 获取可用的 MySQL 版本列表（从阿里云镜像动态获取）
   * 镜像地址: https://mirrors.aliyun.com/mysql/
   */
  async getAvailableVersions(): Promise<AvailableMysqlVersion[]> {
    // 检查缓存
    if (this.cachedVersions && Date.now() - this.cacheTime < this.CACHE_DURATION) {
      console.log('使用缓存的 MySQL 版本列表')
      const installed = await this.getInstalledVersions()
      const installedVersions = installed.map(v => v.version)
      return this.cachedVersions.filter(v => !installedVersions.includes(v.version))
    }

    let versions: AvailableMysqlVersion[] = []

    try {
      console.log('从阿里云镜像获取 MySQL 版本列表...')
      
      // 1. 获取主目录页面，解析出 MySQL-X.X 目录
      const mainPageHtml = await this.fetchHtml(ALIYUN_MIRROR_BASE)
      
      // 匹配 MySQL-5.7, MySQL-8.0 等目录（只获取5.7和8.x系列）
      const dirRegex = /<a href="(MySQL-(5\.7|8\.\d+)\/)">/g
      const mysqlDirs: string[] = []
      let match
      
      while ((match = dirRegex.exec(mainPageHtml)) !== null) {
        mysqlDirs.push(match[1])
      }
      
      console.log(`找到 ${mysqlDirs.length} 个 MySQL 版本目录: ${mysqlDirs.join(', ')}`)

      // 2. 遍历每个目录，获取 Windows 版本的 zip 文件
      for (const dir of mysqlDirs) {
        try {
          const dirUrl = `${ALIYUN_MIRROR_BASE}${dir}`
          const dirHtml = await this.fetchHtml(dirUrl)
          
          // 匹配 mysql-X.X.XX-winx64.zip 格式的文件
          const fileRegex = /<a href="(mysql-(\d+\.\d+\.\d+)-winx64\.zip)">/g
          
          while ((match = fileRegex.exec(dirHtml)) !== null) {
            const fileName = match[1]
            const version = match[2]
            const downloadUrl = `${ALIYUN_MIRROR_BASE}${dir}${fileName}`
            
            // 添加搜狐镜像作为备用
            const majorMinor = version.split('.').slice(0, 2).join('.')
            const sohuUrl = `${SOHU_MIRROR_BASE}MySQL-${majorMinor}/${fileName}`
            
            versions.push({
              version,
              downloadUrl,
              mirrors: [sohuUrl]
            })
          }
        } catch (dirError) {
          console.error(`获取目录 ${dir} 失败:`, dirError)
        }
      }

      // 按版本号降序排序
      versions.sort((a, b) => {
        const aParts = a.version.split('.').map(Number)
        const bParts = b.version.split('.').map(Number)
        for (let i = 0; i < 3; i++) {
          if (bParts[i] !== aParts[i]) {
            return bParts[i] - aParts[i]
          }
        }
        return 0
      })

      // 去重（保留最新版本）
      const seen = new Set<string>()
      versions = versions.filter(v => {
        if (seen.has(v.version)) return false
        seen.add(v.version)
        return true
      })

      console.log(`从阿里云镜像获取到 ${versions.length} 个 MySQL 版本`)
      
      // 更新缓存
      this.cachedVersions = versions
      this.cacheTime = Date.now()

    } catch (error) {
      console.error('从阿里云镜像获取版本列表失败，使用备用列表:', error)
      
      // 备用列表
      versions = [
        {
          version: '8.0.28',
          downloadUrl: 'https://mirrors.sohu.com/mysql/MySQL-8.0/mysql-8.0.28-winx64.zip',
          mirrors: []
        },
        {
          version: '8.0.27',
          downloadUrl: 'https://mirrors.sohu.com/mysql/MySQL-8.0/mysql-8.0.27-winx64.zip',
          mirrors: []
        },
        {
          version: '5.7.38',
          downloadUrl: 'https://mirrors.sohu.com/mysql/MySQL-5.7/mysql-5.7.38-winx64.zip',
          mirrors: []
        },
        {
          version: '5.7.37',
          downloadUrl: 'https://mirrors.sohu.com/mysql/MySQL-5.7/mysql-5.7.37-winx64.zip',
          mirrors: []
        }
      ]
    }

    // 过滤掉已安装的版本
    const installed = await this.getInstalledVersions()
    const installedVersions = installed.map(v => v.version)
    
    return versions.filter(v => !installedVersions.includes(v.version))
  }

  /**
   * 获取网页 HTML 内容
   */
  private async fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      
      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            this.fetchHtml(redirectUrl).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        let html = ''
        response.on('data', (chunk) => (html += chunk))
        response.on('end', () => resolve(html))
        response.on('error', reject)
      })

      request.on('error', reject)
      request.setTimeout(15000, () => {
        request.destroy()
        reject(new Error('请求超时'))
      })
    })
  }

  /**
   * 安装 MySQL 版本
   */
  async install(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions()
      const versionInfo = available.find(v => v.version === version)
      
      if (!versionInfo) {
        return { success: false, message: `未找到 MySQL ${version} 版本` }
      }

      const mysqlPath = this.configStore.getMysqlPath(version)
      const tempPath = this.configStore.getTempPath()
      const mysqlBaseDir = join(this.configStore.getBasePath(), 'mysql')
      const zipPath = join(tempPath, `mysql-${version}.zip`)
      const dataPath = join(mysqlPath, 'data')

      // 确保目录存在
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true })
      }
      if (!existsSync(mysqlBaseDir)) {
        mkdirSync(mysqlBaseDir, { recursive: true })
      }

      // 尝试下载 MySQL（自动尝试备用链接）
      const allUrls = [versionInfo.downloadUrl, ...(versionInfo.mirrors || [])]
      let downloadSuccess = false
      let lastError = ''

      for (const url of allUrls) {
        try {
          console.log(`尝试下载 MySQL ${version} 从 ${url}`)
          await this.downloadFile(url, zipPath)
          downloadSuccess = true
          console.log('下载完成！')
          break
        } catch (error: any) {
          lastError = error.message
          console.log(`下载失败: ${error.message}，尝试下一个镜像...`)
          // 清理失败的下载
          if (existsSync(zipPath)) {
            try { unlinkSync(zipPath) } catch (e) {}
          }
        }
      }

      if (!downloadSuccess) {
        return { success: false, message: `所有下载源均失败: ${lastError}` }
      }
      
      console.log('开始解压...')

      // 解压到 mysql 目录
      await this.unzip(zipPath, mysqlBaseDir)
      
      console.log('解压完成，处理目录...')

      // 重命名目录（MySQL 解压后目录名带完整版本号）
      const extractedDir = join(mysqlBaseDir, `mysql-${version}-winx64`)
      if (existsSync(extractedDir) && !existsSync(mysqlPath)) {
        try {
          renameSync(extractedDir, mysqlPath)
          console.log(`目录重命名: ${extractedDir} -> ${mysqlPath}`)
        } catch (renameError: any) {
          console.error('重命名失败，尝试复制:', renameError.message)
          // 如果重命名失败，可能是跨盘符，尝试使用 fs-extra 或手动复制
        }
      }

      // 删除临时文件
      if (existsSync(zipPath)) {
        try {
          unlinkSync(zipPath)
        } catch (e) {
          console.log('清理临时文件失败，忽略')
        }
      }

      // 创建 data 目录
      if (!existsSync(dataPath)) {
        mkdirSync(dataPath, { recursive: true })
      }

      // 创建 my.ini 配置文件
      await this.createDefaultConfig(mysqlPath, version)

      // 初始化 MySQL
      console.log('初始化 MySQL 数据库...')
      await this.initializeDatabase(mysqlPath)

      // 添加到配置
      this.configStore.addMysqlVersion(version)

      // 启动 MySQL 并设置默认密码
      console.log('启动 MySQL 并设置默认密码...')
      const startResult = await this.start(version)
      if (startResult.success) {
        // 等待 MySQL 完全就绪
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        // 设置默认密码 123456
        try {
          await this.setInitialPassword(mysqlPath, '123456')
          console.log('默认密码设置成功: 123456')
        } catch (pwdError: any) {
          console.log('设置默认密码失败，root密码为空:', pwdError.message)
        }
        
        // 设置密码后停止 MySQL，让用户手动启动
        console.log('停止 MySQL 服务...')
        await this.stop(version)
      }

      console.log(`MySQL ${version} 安装完成`)
      return { 
        success: true, 
        message: `MySQL ${version} 安装成功！\n\n连接信息：\n• 主机：localhost\n• 端口：3306\n• 用户：root\n• 密码：123456\n\n注意：MySQL 已停止，请手动启动服务。` 
      }
    } catch (error: any) {
      console.error('MySQL 安装失败:', error)
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 MySQL 版本
   */
  async uninstall(version: string): Promise<{ success: boolean; message: string }> {
    try {
      // 先停止服务
      await this.stop(version)

      const mysqlPath = this.configStore.getMysqlPath(version)
      
      if (!existsSync(mysqlPath)) {
        return { success: false, message: `MySQL ${version} 未安装` }
      }

      // 移除 Windows 服务
      try {
        await execAsync(`"${join(mysqlPath, 'bin', 'mysqld.exe')}" --remove MySQL${version.replace(/\./g, '')}`)
      } catch (e) {
        // 忽略服务移除错误
      }

      // 递归删除目录
      this.removeDirectory(mysqlPath)

      // 从配置中移除
      this.configStore.removeMysqlVersion(version)

      return { success: true, message: `MySQL ${version} 已卸载` }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 启动 MySQL 服务
   */
  async start(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const mysqlPath = this.configStore.getMysqlPath(version)
      const mysqldPath = join(mysqlPath, 'bin', 'mysqld.exe')
      const configPath = join(mysqlPath, 'my.ini')
      const logsPath = this.configStore.getLogsPath()
      const tempPath = this.configStore.getTempPath()

      if (!existsSync(mysqldPath)) {
        return { success: false, message: `MySQL ${version} 未安装` }
      }

      // 确保临时目录存在
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true })
      }

      // 检查是否已在运行
      const isRunning = await this.checkIsRunning(version)
      if (isRunning) {
        return { success: true, message: `MySQL ${version} 已经在运行` }
      }

      // 检查并修复配置文件（MySQL 8.0 兼容性）
      await this.fixConfigIfNeeded(mysqlPath, version)

      // 检查数据目录是否正确初始化
      const dataPath = join(mysqlPath, 'data')
      const needsInit = await this.checkNeedsInitialize(dataPath)
      if (needsInit) {
        console.log('检测到数据库未正确初始化，正在重新初始化...')
        // 清空数据目录
        if (existsSync(dataPath)) {
          this.removeDirectory(dataPath)
        }
        mkdirSync(dataPath, { recursive: true })
        // 重新初始化
        await this.initializeDatabase(mysqlPath)
      }

      console.log(`启动 MySQL ${version}...`)
      console.log(`mysqld 路径: ${mysqldPath}`)
      console.log(`配置文件: ${configPath}`)

      // 创建 VBScript 来隐藏窗口启动 MySQL
      const vbsPath = join(tempPath, 'start_mysql.vbs')
      const vbsContent = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${mysqldPath.replace(/\\/g, '\\\\')}""" & " --defaults-file=""${configPath.replace(/\\/g, '\\\\')}"" ", 0, False
`
      writeFileSync(vbsPath, vbsContent.trim())
      
      // 使用 wscript 执行 VBS，完全无窗口
      const child = spawn('wscript.exe', [vbsPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })

      child.unref()

      // 删除临时 VBS 文件（延迟删除）
      setTimeout(() => {
        try {
          if (existsSync(vbsPath)) unlinkSync(vbsPath)
        } catch (e) {}
      }, 5000)

      // 等待启动（多次检测，增加等待时间给 PowerShell）
      await new Promise(resolve => setTimeout(resolve, 2000))  // 先等待 PowerShell 启动进程
      
      let running = false
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        running = await this.checkIsRunning(version)
        if (running) {
          console.log(`MySQL ${version} 启动成功 (${i + 1}秒)`)
          break
        }
        console.log(`等待 MySQL 启动... (${i + 1}/15)`)
      }

      if (running) {
        return { success: true, message: `MySQL ${version} 启动成功，端口 3306` }
      } else {
        // 再检查一次进程是否存在
        try {
          const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq mysqld.exe" /NH', { windowsHide: true })
          if (stdout.includes('mysqld.exe')) {
            console.log('检测到 mysqld 进程存在，可能端口检测有问题')
            return { success: true, message: `MySQL ${version} 已启动（进程运行中）` }
          }
        } catch (e) {}

        // 读取错误日志
        const errorLogPath = join(logsPath, 'mysql-error.log')
        let errorInfo = ''
        if (existsSync(errorLogPath)) {
          try {
            const logContent = readFileSync(errorLogPath, 'utf-8')
            const lines = logContent.split('\n').slice(-10)  // 最后10行
            errorInfo = lines.join('\n')
          } catch (e) {}
        }
        return { 
          success: false, 
          message: `MySQL ${version} 启动失败。${errorInfo ? '\n错误日志:\n' + errorInfo : '请检查日志文件'}` 
        }
      }
    } catch (error: any) {
      console.error(`启动 MySQL 失败:`, error)
      return { success: false, message: `启动失败: ${error.message}` }
    }
  }

  /**
   * 停止 MySQL 服务
   */
  async stop(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const mysqlPath = this.configStore.getMysqlPath(version)
      const mysqladminPath = join(mysqlPath, 'bin', 'mysqladmin.exe')

      console.log(`停止 MySQL ${version}...`)

      // 尝试优雅关闭
      try {
        await execAsync(`"${mysqladminPath}" -u root shutdown`, { 
          timeout: 10000,
          windowsHide: true
        })
      } catch (e) {
        console.log('mysqladmin shutdown 失败，尝试 taskkill')
        // 如果优雅关闭失败，尝试强制结束进程
        try {
          await execAsync('taskkill /F /IM mysqld.exe', { 
            timeout: 5000,
            windowsHide: true
          })
        } catch (e2) {
          // 进程可能不存在
          console.log('taskkill 失败，进程可能不存在')
        }
      }

      // 等待进程结束
      await new Promise(resolve => setTimeout(resolve, 2000))

      const isRunning = await this.checkIsRunning(version)
      if (!isRunning) {
        console.log(`MySQL ${version} 已停止`)
        return { success: true, message: `MySQL ${version} 已停止` }
      } else {
        return { success: false, message: `MySQL ${version} 停止失败` }
      }
    } catch (error: any) {
      return { success: false, message: `停止失败: ${error.message}` }
    }
  }

  /**
   * 重启 MySQL 服务
   */
  async restart(version: string): Promise<{ success: boolean; message: string }> {
    const stopResult = await this.stop(version)
    if (!stopResult.success && !stopResult.message.includes('已停止')) {
      return stopResult
    }

    await new Promise(resolve => setTimeout(resolve, 1000))
    return await this.start(version)
  }

  /**
   * 获取 MySQL 运行状态
   */
  async getStatus(version: string): Promise<{ running: boolean; pid?: number; uptime?: string }> {
    const isRunning = await this.checkIsRunning(version)
    
    if (!isRunning) {
      return { running: false }
    }

    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq mysqld.exe" /FO CSV /NH')
      const lines = stdout.trim().split('\n')
      if (lines.length > 0 && lines[0].includes('mysqld.exe')) {
        const parts = lines[0].split(',')
        const pid = parseInt(parts[1].replace(/"/g, ''))
        return { running: true, pid }
      }
    } catch (e) {
      // 忽略错误
    }

    return { running: isRunning }
  }

  /**
   * 修改 root 密码
   */
  async changeRootPassword(version: string, newPassword: string, currentPassword?: string): Promise<{ success: boolean; message: string }> {
    try {
      const mysqlPath = this.configStore.getMysqlPath(version)
      const mysqlExe = join(mysqlPath, 'bin', 'mysql.exe')

      // 检查 MySQL 是否在运行
      const isRunning = await this.checkIsRunning(version)
      if (!isRunning) {
        return { success: false, message: 'MySQL 未运行，请先启动服务' }
      }

      const escapedNewPwd = newPassword.replace(/'/g, "\\'")
      
      // 修改所有 root 用户的密码
      const sql = `
        ALTER USER 'root'@'localhost' IDENTIFIED BY '${escapedNewPwd}';
        ALTER USER IF EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '${escapedNewPwd}';
        ALTER USER IF EXISTS 'root'@'%' IDENTIFIED BY '${escapedNewPwd}';
        FLUSH PRIVILEGES;
      `.replace(/\n/g, ' ').trim()

      // 构建命令，如果提供了当前密码则使用
      let cmd = `"${mysqlExe}" -u root --host=localhost`
      if (currentPassword) {
        cmd += ` -p"${currentPassword.replace(/"/g, '\\"')}"`
      }
      cmd += ` -e "${sql}"`

      await execAsync(cmd, { timeout: 15000, windowsHide: true })

      return { success: true, message: 'root 密码修改成功' }
    } catch (error: any) {
      // 检查是否是密码错误
      if (error.message.includes('Access denied')) {
        return { success: false, message: '当前密码错误，请输入正确的当前密码' }
      }
      return { success: false, message: `密码修改失败: ${error.message}` }
    }
  }

  /**
   * 获取 my.ini 配置内容
   */
  async getConfig(version: string): Promise<string> {
    const mysqlPath = this.configStore.getMysqlPath(version)
    const configPath = join(mysqlPath, 'my.ini')
    
    if (!existsSync(configPath)) {
      return ''
    }

    return readFileSync(configPath, 'utf-8')
  }

  /**
   * 保存 my.ini 配置
   */
  async saveConfig(version: string, config: string): Promise<{ success: boolean; message: string }> {
    try {
      const mysqlPath = this.configStore.getMysqlPath(version)
      const configPath = join(mysqlPath, 'my.ini')
      
      writeFileSync(configPath, config)
      return { success: true, message: 'my.ini 保存成功，需要重启 MySQL 生效' }
    } catch (error: any) {
      return { success: false, message: `保存失败: ${error.message}` }
    }
  }

  /**
   * 设置初始密码（首次安装后使用）
   */
  private async setInitialPassword(mysqlPath: string, password: string): Promise<void> {
    const mysqlExe = join(mysqlPath, 'bin', 'mysql.exe')
    
    // 使用空密码连接并设置新密码，同时授权 127.0.0.1 访问
    const sql = `
      ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}';
      CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '${password}';
      GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
      CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${password}';
      GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
      FLUSH PRIVILEGES;
    `.replace(/\n/g, ' ').trim()
    
    try {
      // 使用 --host=localhost 确保通过 socket 连接
      await execAsync(
        `"${mysqlExe}" -u root --host=localhost -e "${sql}"`,
        { 
          timeout: 15000,
          windowsHide: true,
          cwd: join(mysqlPath, 'bin')
        }
      )
    } catch (error: any) {
      throw new Error(`设置密码失败: ${error.message}`)
    }
  }

  /**
   * 重新初始化数据库（会清空所有数据！）
   */
  async reinitialize(version: string): Promise<{ success: boolean; message: string }> {
    try {
      // 先停止服务
      await this.stop(version)

      const mysqlPath = this.configStore.getMysqlPath(version)
      const dataPath = join(mysqlPath, 'data')

      console.log(`重新初始化 MySQL ${version}...`)

      // 删除数据目录
      if (existsSync(dataPath)) {
        console.log('删除旧数据目录...')
        this.removeDirectory(dataPath)
      }

      // 创建新的数据目录
      mkdirSync(dataPath, { recursive: true })

      // 重新生成配置文件
      await this.createDefaultConfig(mysqlPath, version)

      // 初始化数据库
      await this.initializeDatabase(mysqlPath)

      // 启动并设置默认密码
      console.log('启动 MySQL 并设置默认密码...')
      const startResult = await this.start(version)
      if (startResult.success) {
        await new Promise(resolve => setTimeout(resolve, 3000))
        try {
          await this.setInitialPassword(mysqlPath, '123456')
          console.log('默认密码设置成功: 123456')
        } catch (e) {
          console.log('设置默认密码失败')
        }
      }

      console.log(`MySQL ${version} 重新初始化完成`)
      return { 
        success: true, 
        message: `MySQL ${version} 重新初始化成功！\n\n连接信息：\n• 用户：root\n• 密码：123456` 
      }
    } catch (error: any) {
      console.error('重新初始化失败:', error)
      return { success: false, message: `重新初始化失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 检查数据库是否需要初始化
   */
  private async checkNeedsInitialize(dataPath: string): Promise<boolean> {
    if (!existsSync(dataPath)) {
      return true
    }

    const files = readdirSync(dataPath)
    if (files.length === 0) {
      return true
    }

    // 检查关键的 mysql 系统数据库目录是否存在
    const mysqlDbPath = join(dataPath, 'mysql')
    if (!existsSync(mysqlDbPath)) {
      console.log('mysql 系统数据库目录不存在，需要重新初始化')
      return true
    }

    // 检查是否有必要的系统文件
    const requiredFiles = ['ibdata1', 'ib_logfile0']
    for (const file of requiredFiles) {
      // MySQL 8.0.30+ 可能没有 ib_logfile，所以只检查 ibdata1
      if (file === 'ibdata1' && !existsSync(join(dataPath, file))) {
        console.log(`缺少 ${file}，需要重新初始化`)
        return true
      }
    }

    return false
  }

  /**
   * 检查并修复配置文件（MySQL 8.0 兼容性）
   */
  private async fixConfigIfNeeded(mysqlPath: string, version: string): Promise<void> {
    const configPath = join(mysqlPath, 'my.ini')
    
    if (!existsSync(configPath)) {
      console.log('配置文件不存在，重新创建')
      await this.createDefaultConfig(mysqlPath, version)
      return
    }

    const majorVersion = parseInt(version.split('.')[0])
    const isMySQL8 = majorVersion >= 8

    if (isMySQL8) {
      let content = readFileSync(configPath, 'utf-8')
      let needsUpdate = false

      // 检查是否包含 MySQL 8.0 不支持的配置
      const deprecatedConfigs = [
        /^query_cache_type\s*=.*$/gm,
        /^query_cache_size\s*=.*$/gm,
        /^query_cache_limit\s*=.*$/gm,
        /^innodb_log_file_size\s*=.*$/gm,  // 8.0.30+ 自动管理
      ]

      for (const regex of deprecatedConfigs) {
        if (regex.test(content)) {
          content = content.replace(regex, '# [已移除 - MySQL 8.0 不支持]')
          needsUpdate = true
        }
      }

      if (needsUpdate) {
        console.log('检测到 MySQL 8.0 不兼容配置，正在修复...')
        writeFileSync(configPath, content)
        console.log('配置文件已修复')
      }
    }
  }

  private async checkIsRunning(version: string): Promise<boolean> {
    try {
      const mysqlPath = this.configStore.getMysqlPath(version)
      const port = this.getPortFromConfig(mysqlPath)
      
      const { stdout } = await execAsync(`netstat -ano | findstr ":${port}"`)
      return stdout.includes('LISTENING')
    } catch (e) {
      return false
    }
  }

  private getPortFromConfig(mysqlPath: string): number {
    const configPath = join(mysqlPath, 'my.ini')
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8')
      const match = content.match(/port\s*=\s*(\d+)/)
      if (match) {
        return parseInt(match[1])
      }
    }
    return 3306
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    // 确保目标目录存在
    const destDir = dirname(dest)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }

    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest)
      const protocol = url.startsWith('https') ? https : http

      console.log(`下载: ${url}`)

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            if (existsSync(dest)) unlinkSync(dest)
            console.log(`重定向到: ${redirectUrl}`)
            this.downloadFile(redirectUrl, dest).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          file.close()
          if (existsSync(dest)) unlinkSync(dest)
          reject(new Error(`下载失败，状态码: ${response.statusCode}, URL: ${url}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0
        let lastProgressTime = Date.now()

        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          const now = Date.now()
          // 每500ms发送一次进度
          if (now - lastProgressTime > 500) {
            const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
            sendDownloadProgress('mysql', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)
        
        file.on('finish', () => {
          file.close()
          sendDownloadProgress('mysql', 100, totalSize, totalSize)
          console.log('下载完成')
          resolve()
        })
        
        file.on('error', (err) => {
          file.close()
          if (existsSync(dest)) unlinkSync(dest)
          reject(err)
        })
      })

      request.on('error', (err) => {
        file.close()
        if (existsSync(dest)) unlinkSync(dest)
        reject(new Error(`网络错误: ${err.message}`))
      })

      // 10 分钟超时（MySQL 包较大）
      request.setTimeout(600000, () => {
        request.destroy()
        file.close()
        if (existsSync(dest)) unlinkSync(dest)
        reject(new Error('下载超时（10分钟）'))
      })
    })
  }

  private async unzip(zipPath: string, destPath: string): Promise<void> {
    // 确保目标目录存在
    if (!existsSync(destPath)) {
      mkdirSync(destPath, { recursive: true })
    }

    const { createReadStream } = await import('fs')
    const unzipper = await import('unzipper')
    
    return new Promise((resolve, reject) => {
      console.log(`解压: ${zipPath} -> ${destPath}`)
      
      const stream = createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destPath }))
      
      stream.on('close', () => {
        console.log('解压完成')
        resolve()
      })
      
      stream.on('error', (err: Error) => {
        console.error('解压错误:', err)
        reject(new Error(`解压失败: ${err.message}`))
      })
    })
  }

  private async createDefaultConfig(mysqlPath: string, version: string): Promise<void> {
    const configPath = join(mysqlPath, 'my.ini')
    const dataPath = join(mysqlPath, 'data')
    const logsPath = this.configStore.getLogsPath()

    // 确保日志目录存在
    if (!existsSync(logsPath)) {
      mkdirSync(logsPath, { recursive: true })
    }

    // 判断是否是 MySQL 8.0+
    const majorVersion = parseInt(version.split('.')[0])
    const isMySQL8 = majorVersion >= 8

    // MySQL 8.0 移除了 query_cache，需要区分配置
    const cacheConfig = isMySQL8 ? '' : `
# 查询缓存 (仅 MySQL 5.7)
query_cache_type=1
query_cache_size=64M`

    const config = `[mysqld]
# 基础配置
basedir=${mysqlPath.replace(/\\/g, '/')}
datadir=${dataPath.replace(/\\/g, '/')}
port=3306
bind-address=0.0.0.0
server-id=1

# 字符集
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci

# 连接数
max_connections=200
max_connect_errors=10

# 存储引擎
default-storage-engine=INNODB

# 日志
log-error=${logsPath.replace(/\\/g, '/')}/mysql-error.log
slow_query_log=1
slow_query_log_file=${logsPath.replace(/\\/g, '/')}/mysql-slow.log
long_query_time=10
${cacheConfig}

# 表缓存
table_open_cache=2000
tmp_table_size=64M
max_heap_table_size=64M

# InnoDB
innodb_buffer_pool_size=256M
innodb_log_buffer_size=16M
innodb_flush_log_at_trx_commit=1
innodb_lock_wait_timeout=50

# 跳过时区设置（避免初始化问题）
# default-time-zone='+8:00'

# 允许本地加载数据
local_infile=1

# 注意：不要启用 skip-name-resolve，否则 localhost 和 127.0.0.1 会被视为不同主机

[mysql]
default-character-set=utf8mb4

[client]
port=3306
default-character-set=utf8mb4
`

    writeFileSync(configPath, config)
    console.log(`创建 MySQL ${version} 配置文件: ${configPath}`)
  }

  private async initializeDatabase(mysqlPath: string): Promise<void> {
    const mysqldPath = join(mysqlPath, 'bin', 'mysqld.exe')
    const configPath = join(mysqlPath, 'my.ini')
    const dataPath = join(mysqlPath, 'data')

    // 检查是否已经初始化过
    if (existsSync(dataPath)) {
      const files = readdirSync(dataPath)
      if (files.length > 0) {
        console.log('MySQL 数据目录不为空，跳过初始化')
        return
      }
    }

    console.log('开始初始化 MySQL 数据库...')

    // 使用 execAsync 初始化数据库（初始化是一次性操作，可以等待完成）
    return new Promise(async (resolve, reject) => {
      try {
        // 初始化命令需要等待完成
        await execAsync(
          `"${mysqldPath}" --defaults-file="${configPath}" --initialize-insecure`,
          { 
            timeout: 120000,
            windowsHide: true,
            cwd: join(mysqlPath, 'bin')
          }
        )
        console.log('MySQL 初始化命令执行完成')
      } catch (error: any) {
        console.log('MySQL 初始化命令返回:', error.message)
      }

      // 检查数据目录是否有文件
      setTimeout(() => {
        const files = existsSync(dataPath) ? readdirSync(dataPath) : []
        if (files.length > 0) {
          console.log('数据目录已创建，初始化成功')
          resolve()
        } else {
          reject(new Error('初始化失败，数据目录为空'))
        }
      }, 2000)
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

