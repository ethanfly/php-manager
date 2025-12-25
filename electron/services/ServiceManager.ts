import { ConfigStore } from './ConfigStore'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

interface ServiceStatus {
  name: string
  displayName: string
  running: boolean
  autoStart: boolean
}

export class ServiceManager {
  private configStore: ConfigStore
  private startupDir: string

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
    // Windows 启动目录
    this.startupDir = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  }

  /**
   * 获取所有服务状态
   */
  async getAllServices(): Promise<ServiceStatus[]> {
    const services: ServiceStatus[] = []
    
    // 检查 Nginx
    const nginxPath = this.configStore.getNginxPath()
    if (existsSync(join(nginxPath, 'nginx.exe'))) {
      const running = await this.checkProcess('nginx.exe')
      const autoStart = this.checkAutoStart('nginx')
      services.push({
        name: 'nginx',
        displayName: 'Nginx',
        running,
        autoStart
      })
    }

    // 检查 MySQL
    const mysqlVersions = this.configStore.get('mysqlVersions')
    for (const version of mysqlVersions) {
      const mysqlPath = this.configStore.getMysqlPath(version)
      if (existsSync(join(mysqlPath, 'bin', 'mysqld.exe'))) {
        const running = await this.checkProcess('mysqld.exe')
        const autoStart = this.checkAutoStart(`mysql-${version}`)
        services.push({
          name: `mysql-${version}`,
          displayName: `MySQL ${version}`,
          running,
          autoStart
        })
      }
    }

    // 检查 Redis
    const redisPath = this.configStore.getRedisPath()
    if (existsSync(join(redisPath, 'redis-server.exe'))) {
      const running = await this.checkProcess('redis-server.exe')
      const autoStart = this.checkAutoStart('redis')
      services.push({
        name: 'redis',
        displayName: 'Redis',
        running,
        autoStart
      })
    }

    // 检查 PHP-CGI
    const activePhp = this.configStore.get('activePhpVersion')
    if (activePhp) {
      const phpPath = this.configStore.getPhpPath(activePhp)
      if (existsSync(join(phpPath, 'php-cgi.exe'))) {
        const running = await this.checkProcess('php-cgi.exe')
        const autoStart = this.checkAutoStart('php-cgi')
        services.push({
          name: 'php-cgi',
          displayName: `PHP-CGI (${activePhp})`,
          running,
          autoStart
        })
      }
    }

    return services
  }

  /**
   * 设置服务开机自启
   */
  async setAutoStart(service: string, enabled: boolean): Promise<{ success: boolean; message: string }> {
    try {
      const batPath = join(this.startupDir, `phper-${service}.bat`)

      if (enabled) {
        // 创建启动脚本
        let script = '@echo off\n'
        script += `cd /d "${this.configStore.getBasePath()}"\n`

        if (service === 'nginx') {
          const nginxPath = this.configStore.getNginxPath()
          script += `start "" /B "${join(nginxPath, 'nginx.exe')}"\n`
        } else if (service.startsWith('mysql-')) {
          const version = service.replace('mysql-', '')
          const mysqlPath = this.configStore.getMysqlPath(version)
          script += `start "" /B "${join(mysqlPath, 'bin', 'mysqld.exe')}" --defaults-file="${join(mysqlPath, 'my.ini')}"\n`
        } else if (service === 'redis') {
          const redisPath = this.configStore.getRedisPath()
          script += `start "" /B "${join(redisPath, 'redis-server.exe')}" "${join(redisPath, 'redis.windows.conf')}"\n`
        } else if (service === 'php-cgi') {
          const activePhp = this.configStore.get('activePhpVersion')
          if (activePhp) {
            const phpPath = this.configStore.getPhpPath(activePhp)
            script += `start "" /B "${join(phpPath, 'php-cgi.exe')}" -b 127.0.0.1:9000\n`
          }
        }

        writeFileSync(batPath, script)
        
        // 更新配置
        const autoStart = this.configStore.get('autoStart')
        if (service === 'nginx') autoStart.nginx = true
        else if (service.startsWith('mysql')) autoStart.mysql = true
        else if (service === 'redis') autoStart.redis = true
        this.configStore.set('autoStart', autoStart)

        return { success: true, message: `${service} 开机自启已启用` }
      } else {
        // 删除启动脚本
        if (existsSync(batPath)) {
          const { unlinkSync } = await import('fs')
          unlinkSync(batPath)
        }
        
        // 更新配置
        const autoStart = this.configStore.get('autoStart')
        if (service === 'nginx') autoStart.nginx = false
        else if (service.startsWith('mysql')) autoStart.mysql = false
        else if (service === 'redis') autoStart.redis = false
        this.configStore.set('autoStart', autoStart)

        return { success: true, message: `${service} 开机自启已禁用` }
      }
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` }
    }
  }

  /**
   * 检查服务是否开机自启
   */
  getAutoStart(service: string): boolean {
    return this.checkAutoStart(service)
  }

  /**
   * 启动所有已安装的服务
   */
  async startAll(): Promise<{ success: boolean; message: string; details: string[] }> {
    const details: string[] = []

    try {
      // 启动 Nginx
      const nginxPath = this.configStore.getNginxPath()
      if (existsSync(join(nginxPath, 'nginx.exe'))) {
        if (!(await this.checkProcess('nginx.exe'))) {
          await this.startProcess(join(nginxPath, 'nginx.exe'), [], nginxPath)
          details.push('Nginx 已启动')
        } else {
          details.push('Nginx 已在运行')
        }
      }

      // 启动 MySQL (启动第一个已安装的版本)
      const mysqlVersions = this.configStore.get('mysqlVersions')
      if (mysqlVersions.length > 0) {
        if (!(await this.checkProcess('mysqld.exe'))) {
          for (const version of mysqlVersions) {
            const mysqlPath = this.configStore.getMysqlPath(version)
            const mysqld = join(mysqlPath, 'bin', 'mysqld.exe')
            if (existsSync(mysqld)) {
              // 使用 VBScript 隐藏窗口启动
              const vbsPath = join(mysqlPath, 'start_mysql.vbs')
              const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${mysqld}"" --defaults-file=""${join(mysqlPath, 'my.ini')}""", 0, False`
              writeFileSync(vbsPath, vbsContent)
              await execAsync(`cscript //nologo "${vbsPath}"`, { cwd: mysqlPath })
              details.push(`MySQL ${version} 已启动`)
              break // 只启动第一个版本
            }
          }
        } else {
          details.push('MySQL 已在运行')
        }
      }

      // 启动 Redis
      const redisPath = this.configStore.getRedisPath()
      const redisServer = join(redisPath, 'redis-server.exe')
      if (existsSync(redisServer)) {
        if (!(await this.checkProcess('redis-server.exe'))) {
          const configFile = join(redisPath, 'redis.windows.conf')
          const args = existsSync(configFile) ? ['redis.windows.conf'] : []
          await this.startProcess(redisServer, args, redisPath)
          details.push('Redis 已启动')
        } else {
          details.push('Redis 已在运行')
        }
      }

      if (details.length === 0) {
        return { success: true, message: '没有已安装的服务', details }
      }

      return { success: true, message: '服务启动完成', details }
    } catch (error: any) {
      return { success: false, message: `启动失败: ${error.message}`, details }
    }
  }

  /**
   * 停止所有服务
   */
  async stopAll(): Promise<{ success: boolean; message: string; details: string[] }> {
    const details: string[] = []

    try {
      // 停止 PHP-CGI
      if (await this.checkProcess('php-cgi.exe')) {
        await execAsync('taskkill /F /IM php-cgi.exe', { timeout: 5000 }).catch(() => {})
        details.push('PHP-CGI 已停止')
      }

      // 停止 Nginx
      if (await this.checkProcess('nginx.exe')) {
        const nginxPath = this.configStore.getNginxPath()
        try {
          await execAsync(`"${join(nginxPath, 'nginx.exe')}" -s stop`, { cwd: nginxPath, timeout: 5000 })
        } catch (e) {
          await execAsync('taskkill /F /IM nginx.exe', { timeout: 5000 }).catch(() => {})
        }
        details.push('Nginx 已停止')
      }

      // 停止 MySQL
      if (await this.checkProcess('mysqld.exe')) {
        await execAsync('taskkill /F /IM mysqld.exe', { timeout: 5000 }).catch(() => {})
        details.push('MySQL 已停止')
      }

      // 停止 Redis
      if (await this.checkProcess('redis-server.exe')) {
        const redisPath = this.configStore.getRedisPath()
        const redisCli = join(redisPath, 'redis-cli.exe')
        if (existsSync(redisCli)) {
          try {
            await execAsync(`"${redisCli}" shutdown`, { timeout: 5000 })
          } catch (e) {
            await execAsync('taskkill /F /IM redis-server.exe', { timeout: 5000 }).catch(() => {})
          }
        } else {
          await execAsync('taskkill /F /IM redis-server.exe', { timeout: 5000 }).catch(() => {})
        }
        details.push('Redis 已停止')
      }

      return { success: true, message: '所有服务已停止', details }
    } catch (error: any) {
      return { success: false, message: `停止失败: ${error.message}`, details }
    }
  }

  /**
   * 启动 PHP-CGI 进程（FastCGI）
   */
  async startPhpCgi(): Promise<{ success: boolean; message: string }> {
    try {
      const activePhp = this.configStore.get('activePhpVersion')
      if (!activePhp) {
        return { success: false, message: '未设置活动的 PHP 版本' }
      }

      const phpPath = this.configStore.getPhpPath(activePhp)
      const phpCgi = join(phpPath, 'php-cgi.exe')

      if (!existsSync(phpCgi)) {
        return { success: false, message: 'php-cgi.exe 不存在' }
      }

      // 检查是否已在运行
      if (await this.checkProcess('php-cgi.exe')) {
        return { success: true, message: 'PHP-CGI 已经在运行' }
      }

      // 启动 PHP-CGI
      await this.startProcess(phpCgi, ['-b', '127.0.0.1:9000'], phpPath)

      // 等待启动
      await new Promise(resolve => setTimeout(resolve, 1000))

      if (await this.checkProcess('php-cgi.exe')) {
        return { success: true, message: 'PHP-CGI 启动成功' }
      } else {
        return { success: false, message: 'PHP-CGI 启动失败' }
      }
    } catch (error: any) {
      return { success: false, message: `启动失败: ${error.message}` }
    }
  }

  /**
   * 停止 PHP-CGI 进程
   */
  async stopPhpCgi(): Promise<{ success: boolean; message: string }> {
    try {
      await execAsync('taskkill /F /IM php-cgi.exe', { timeout: 5000 })
      return { success: true, message: 'PHP-CGI 已停止' }
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return { success: true, message: 'PHP-CGI 未运行' }
      }
      return { success: false, message: `停止失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  private async checkProcess(name: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${name}" /FO CSV /NH`)
      return stdout.includes(name)
    } catch (e) {
      return false
    }
  }

  private checkAutoStart(service: string): boolean {
    const batPath = join(this.startupDir, `phper-${service}.bat`)
    return existsSync(batPath)
  }

  private async startProcess(exe: string, args: string[], cwd: string): Promise<void> {
    const child = spawn(exe, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
  }
}

