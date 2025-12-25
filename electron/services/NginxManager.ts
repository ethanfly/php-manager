import { ConfigStore, SiteConfig } from './ConfigStore'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmdirSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import { sendDownloadProgress } from '../main'

const execAsync = promisify(exec)

interface NginxVersion {
  version: string
  path: string
}

interface AvailableNginxVersion {
  version: string
  downloadUrl: string
}

interface NginxStatus {
  running: boolean
  pid?: number
  activeConnections?: number
}

export class NginxManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取已安装的 Nginx 版本列表
   */
  async getInstalledVersions(): Promise<NginxVersion[]> {
    const versions: NginxVersion[] = []
    const nginxDir = this.configStore.getNginxPath()

    if (!existsSync(nginxDir)) {
      return versions
    }

    // 检查是否存在 nginx.exe
    if (existsSync(join(nginxDir, 'nginx.exe'))) {
      // 获取版本号
      try {
        const { stdout } = await execAsync(`"${join(nginxDir, 'nginx.exe')}" -v 2>&1`)
        const match = stdout.match(/nginx\/(\d+\.\d+\.\d+)/)
        if (match) {
          versions.push({
            version: match[1],
            path: nginxDir
          })
        }
      } catch (error: any) {
        // nginx -v 输出到 stderr
        const match = error.message?.match(/nginx\/(\d+\.\d+\.\d+)/) || 
                     error.stderr?.match(/nginx\/(\d+\.\d+\.\d+)/)
        if (match) {
          versions.push({
            version: match[1],
            path: nginxDir
          })
        }
      }
    }

    return versions
  }

  /**
   * 获取可用的 Nginx 版本列表
   */
  async getAvailableVersions(): Promise<AvailableNginxVersion[]> {
    const versions: AvailableNginxVersion[] = [
      {
        version: '1.27.3',
        downloadUrl: 'https://nginx.org/download/nginx-1.27.3.zip'
      },
      {
        version: '1.26.2',
        downloadUrl: 'https://nginx.org/download/nginx-1.26.2.zip'
      },
      {
        version: '1.25.5',
        downloadUrl: 'https://nginx.org/download/nginx-1.25.5.zip'
      },
      {
        version: '1.24.0',
        downloadUrl: 'https://nginx.org/download/nginx-1.24.0.zip'
      }
    ]

    return versions
  }

  /**
   * 安装 Nginx 版本
   */
  async install(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions()
      const versionInfo = available.find(v => v.version === version)
      
      if (!versionInfo) {
        return { success: false, message: `未找到 Nginx ${version} 版本` }
      }

      const nginxPath = this.configStore.getNginxPath()
      const tempPath = this.configStore.getTempPath()
      const zipPath = join(tempPath, `nginx-${version}.zip`)

      // 如果已有 Nginx 安装，先备份配置
      let oldConfig = ''
      const configPath = join(nginxPath, 'conf', 'nginx.conf')
      if (existsSync(configPath)) {
        oldConfig = readFileSync(configPath, 'utf-8')
      }

      // 下载 Nginx
      await this.downloadFile(versionInfo.downloadUrl, zipPath)

      // 解压
      const basePath = this.configStore.getBasePath()
      await this.unzip(zipPath, basePath)

      // 重命名目录
      const extractedDir = join(basePath, `nginx-${version}`)
      if (existsSync(extractedDir) && extractedDir !== nginxPath) {
        // 如果目标目录已存在，先删除
        if (existsSync(nginxPath)) {
          this.removeDirectory(nginxPath)
        }
        const { rename } = await import('fs/promises')
        await rename(extractedDir, nginxPath)
      }

      // 删除临时文件
      if (existsSync(zipPath)) {
        unlinkSync(zipPath)
      }

      // 创建必要的目录
      const sitesAvailable = this.configStore.getSitesAvailablePath()
      const sitesEnabled = this.configStore.getSitesEnabledPath()
      const sslPath = this.configStore.getSSLPath()
      
      if (!existsSync(sitesAvailable)) mkdirSync(sitesAvailable, { recursive: true })
      if (!existsSync(sitesEnabled)) mkdirSync(sitesEnabled, { recursive: true })
      if (!existsSync(sslPath)) mkdirSync(sslPath, { recursive: true })

      // 恢复或创建配置
      if (oldConfig) {
        writeFileSync(configPath, oldConfig)
      } else {
        await this.createDefaultConfig()
      }

      return { success: true, message: `Nginx ${version} 安装成功` }
    } catch (error: any) {
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 Nginx
   */
  async uninstall(version: string): Promise<{ success: boolean; message: string }> {
    try {
      // 先停止服务
      await this.stop()

      const nginxPath = this.configStore.getNginxPath()
      
      if (!existsSync(nginxPath)) {
        return { success: false, message: 'Nginx 未安装' }
      }

      // 递归删除目录（保留 sites 和 ssl 目录）
      const items = readdirSync(nginxPath, { withFileTypes: true })
      for (const item of items) {
        const itemPath = join(nginxPath, item.name)
        if (item.name !== 'sites-available' && item.name !== 'sites-enabled' && item.name !== 'ssl') {
          if (item.isDirectory()) {
            this.removeDirectory(itemPath)
          } else {
            unlinkSync(itemPath)
          }
        }
      }

      return { success: true, message: 'Nginx 已卸载' }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 启动 Nginx
   */
  async start(): Promise<{ success: boolean; message: string }> {
    try {
      const nginxPath = this.configStore.getNginxPath()
      const nginxExe = join(nginxPath, 'nginx.exe')

      if (!existsSync(nginxExe)) {
        return { success: false, message: 'Nginx 未安装' }
      }

      // 检查是否已在运行
      const status = await this.getStatus()
      if (status.running) {
        return { success: true, message: 'Nginx 已经在运行' }
      }

      // 启动 Nginx
      const child = spawn(nginxExe, [], {
        cwd: nginxPath,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()

      // 等待启动
      await new Promise(resolve => setTimeout(resolve, 1000))

      const newStatus = await this.getStatus()
      if (newStatus.running) {
        return { success: true, message: 'Nginx 启动成功' }
      } else {
        return { success: false, message: 'Nginx 启动失败，请检查配置' }
      }
    } catch (error: any) {
      return { success: false, message: `启动失败: ${error.message}` }
    }
  }

  /**
   * 停止 Nginx
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    try {
      const nginxPath = this.configStore.getNginxPath()
      const nginxExe = join(nginxPath, 'nginx.exe')

      if (existsSync(nginxExe)) {
        try {
          await execAsync(`"${nginxExe}" -s stop`, { cwd: nginxPath, timeout: 10000 })
        } catch (e) {
          // 如果 -s stop 失败，尝试强制结束
          try {
            await execAsync('taskkill /F /IM nginx.exe', { timeout: 5000 })
          } catch (e2) {
            // 进程可能不存在
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000))

      const status = await this.getStatus()
      if (!status.running) {
        return { success: true, message: 'Nginx 已停止' }
      } else {
        return { success: false, message: 'Nginx 停止失败' }
      }
    } catch (error: any) {
      return { success: false, message: `停止失败: ${error.message}` }
    }
  }

  /**
   * 重启 Nginx
   */
  async restart(): Promise<{ success: boolean; message: string }> {
    await this.stop()
    await new Promise(resolve => setTimeout(resolve, 500))
    return await this.start()
  }

  /**
   * 重载配置
   */
  async reload(): Promise<{ success: boolean; message: string }> {
    try {
      const nginxPath = this.configStore.getNginxPath()
      const nginxExe = join(nginxPath, 'nginx.exe')

      if (!existsSync(nginxExe)) {
        return { success: false, message: 'Nginx 未安装' }
      }

      await execAsync(`"${nginxExe}" -s reload`, { cwd: nginxPath })
      return { success: true, message: '配置已重载' }
    } catch (error: any) {
      return { success: false, message: `重载失败: ${error.message}` }
    }
  }

  /**
   * 获取 Nginx 状态
   */
  async getStatus(): Promise<NginxStatus> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq nginx.exe" /FO CSV /NH')
      const lines = stdout.trim().split('\n')
      
      if (lines.length > 0 && lines[0].includes('nginx.exe')) {
        const parts = lines[0].split(',')
        const pid = parseInt(parts[1].replace(/"/g, ''))
        return { running: true, pid }
      }
    } catch (e) {
      // 忽略错误
    }

    return { running: false }
  }

  /**
   * 获取 nginx.conf 配置内容
   */
  async getConfig(): Promise<string> {
    const configPath = join(this.configStore.getNginxPath(), 'conf', 'nginx.conf')
    
    if (!existsSync(configPath)) {
      return ''
    }

    return readFileSync(configPath, 'utf-8')
  }

  /**
   * 保存 nginx.conf 配置
   */
  async saveConfig(config: string): Promise<{ success: boolean; message: string }> {
    try {
      const configPath = join(this.configStore.getNginxPath(), 'conf', 'nginx.conf')
      
      // 先测试配置
      const tempPath = join(this.configStore.getTempPath(), 'nginx-test.conf')
      writeFileSync(tempPath, config)

      const nginxExe = join(this.configStore.getNginxPath(), 'nginx.exe')
      try {
        await execAsync(`"${nginxExe}" -t -c "${tempPath}"`, { cwd: this.configStore.getNginxPath() })
      } catch (testError: any) {
        unlinkSync(tempPath)
        return { success: false, message: `配置验证失败: ${testError.stderr || testError.message}` }
      }

      unlinkSync(tempPath)
      writeFileSync(configPath, config)
      return { success: true, message: 'nginx.conf 保存成功' }
    } catch (error: any) {
      return { success: false, message: `保存失败: ${error.message}` }
    }
  }

  /**
   * 获取站点列表
   */
  async getSites(): Promise<SiteConfig[]> {
    return this.configStore.getSites()
  }

  /**
   * 添加站点
   */
  async addSite(site: SiteConfig): Promise<{ success: boolean; message: string }> {
    try {
      // 生成配置文件
      const config = site.isLaravel 
        ? this.generateLaravelSiteConfig(site)
        : this.generateSiteConfig(site)

      const sitesAvailable = this.configStore.getSitesAvailablePath()
      const configPath = join(sitesAvailable, `${site.name}.conf`)
      
      writeFileSync(configPath, config)

      // 启用站点
      if (site.enabled) {
        await this.enableSite(site.name)
      }

      // 保存到配置
      this.configStore.addSite(site)

      return { success: true, message: `站点 ${site.name} 创建成功` }
    } catch (error: any) {
      return { success: false, message: `创建站点失败: ${error.message}` }
    }
  }

  /**
   * 删除站点
   */
  async removeSite(name: string): Promise<{ success: boolean; message: string }> {
    try {
      const sitesAvailable = this.configStore.getSitesAvailablePath()
      const sitesEnabled = this.configStore.getSitesEnabledPath()
      
      const availablePath = join(sitesAvailable, `${name}.conf`)
      const enabledPath = join(sitesEnabled, `${name}.conf`)

      if (existsSync(enabledPath)) unlinkSync(enabledPath)
      if (existsSync(availablePath)) unlinkSync(availablePath)

      this.configStore.removeSite(name)

      return { success: true, message: `站点 ${name} 已删除` }
    } catch (error: any) {
      return { success: false, message: `删除站点失败: ${error.message}` }
    }
  }

  /**
   * 更新站点
   */
  async updateSite(originalName: string, site: SiteConfig): Promise<{ success: boolean; message: string }> {
    try {
      const sitesAvailable = this.configStore.getSitesAvailablePath()
      const sitesEnabled = this.configStore.getSitesEnabledPath()
      
      // 如果站点名称没变，直接更新配置文件
      const configPath = join(sitesAvailable, `${originalName}.conf`)
      const enabledPath = join(sitesEnabled, `${originalName}.conf`)
      
      // 检查是否之前是启用状态
      const wasEnabled = existsSync(enabledPath)
      
      // 生成新的配置内容
      const config = site.isLaravel 
        ? this.generateLaravelSiteConfig(site)
        : this.generateSiteConfig(site)
      
      // 写入配置文件
      writeFileSync(configPath, config)
      
      // 如果之前是启用状态，更新启用的配置
      if (wasEnabled) {
        writeFileSync(enabledPath, config)
      }
      
      // 更新存储的配置
      this.configStore.updateSite(originalName, site)
      
      return { success: true, message: `站点 ${site.name} 更新成功` }
    } catch (error: any) {
      return { success: false, message: `更新站点失败: ${error.message}` }
    }
  }

  /**
   * 启用站点
   */
  async enableSite(name: string): Promise<{ success: boolean; message: string }> {
    try {
      const sitesAvailable = this.configStore.getSitesAvailablePath()
      const sitesEnabled = this.configStore.getSitesEnabledPath()
      
      const availablePath = join(sitesAvailable, `${name}.conf`)
      const enabledPath = join(sitesEnabled, `${name}.conf`)

      if (!existsSync(availablePath)) {
        return { success: false, message: `站点配置 ${name} 不存在` }
      }

      // 复制配置到 enabled 目录
      copyFileSync(availablePath, enabledPath)
      
      this.configStore.updateSite(name, { enabled: true })

      return { success: true, message: `站点 ${name} 已启用` }
    } catch (error: any) {
      return { success: false, message: `启用站点失败: ${error.message}` }
    }
  }

  /**
   * 禁用站点
   */
  async disableSite(name: string): Promise<{ success: boolean; message: string }> {
    try {
      const sitesEnabled = this.configStore.getSitesEnabledPath()
      const enabledPath = join(sitesEnabled, `${name}.conf`)

      if (existsSync(enabledPath)) {
        unlinkSync(enabledPath)
      }
      
      this.configStore.updateSite(name, { enabled: false })

      return { success: true, message: `站点 ${name} 已禁用` }
    } catch (error: any) {
      return { success: false, message: `禁用站点失败: ${error.message}` }
    }
  }

  /**
   * 生成 Laravel 配置
   */
  async generateLaravelConfig(site: SiteConfig): Promise<string> {
    return this.generateLaravelSiteConfig(site)
  }

  /**
   * 申请 SSL 证书（Let's Encrypt）
   */
  async requestSSLCertificate(domain: string, email: string): Promise<{ success: boolean; message: string }> {
    try {
      // 检查是否安装了 win-acme
      const acmePath = join(this.configStore.getBasePath(), 'tools', 'win-acme')
      const wacs = join(acmePath, 'wacs.exe')

      if (!existsSync(wacs)) {
        return { 
          success: false, 
          message: '请先下载 win-acme 工具到 tools/win-acme 目录。下载地址: https://www.win-acme.com/' 
        }
      }

      const sslPath = this.configStore.getSSLPath()
      const certPath = join(sslPath, domain)
      
      if (!existsSync(certPath)) {
        mkdirSync(certPath, { recursive: true })
      }

      // 使用 win-acme 申请证书
      const command = `"${wacs}" --target manual --host ${domain} --validation selfhosting --emailaddress ${email} --accepttos --store pemfiles --pemfilespath "${certPath}"`
      
      await execAsync(command, { timeout: 120000 })

      return { success: true, message: `SSL 证书已申请成功，保存在 ${certPath}` }
    } catch (error: any) {
      return { success: false, message: `申请 SSL 证书失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  private async createDefaultConfig(): Promise<void> {
    const nginxPath = this.configStore.getNginxPath()
    const configPath = join(nginxPath, 'conf', 'nginx.conf')
    const logsPath = this.configStore.getLogsPath()
    const sitesEnabled = this.configStore.getSitesEnabledPath()

    const config = `
worker_processes  auto;

error_log  "${logsPath.replace(/\\/g, '/')}/nginx-error.log";
pid        "${nginxPath.replace(/\\/g, '/')}/nginx.pid";

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  "${logsPath.replace(/\\/g, '/')}/nginx-access.log"  main;

    sendfile        on;
    keepalive_timeout  65;
    
    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml application/atom+xml image/svg+xml;

    # 上传大小限制
    client_max_body_size 100M;

    # 包含所有启用的站点配置
    include "${sitesEnabled.replace(/\\/g, '/')}/*.conf";

    # 默认服务器
    server {
        listen       80;
        server_name  localhost;

        location / {
            root   html;
            index  index.html index.htm index.php;
        }

        error_page   500 502 503 504  /50x.html;
        location = /50x.html {
            root   html;
        }
    }
}
`

    writeFileSync(configPath, config)
  }

  private generateSiteConfig(site: SiteConfig): string {
    const phpPath = this.configStore.getPhpPath(site.phpVersion)
    const logsPath = this.configStore.getLogsPath()

    let config = `
server {
    listen 80;
    server_name ${site.domain};
    root "${site.rootPath.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    access_log "${logsPath.replace(/\\/g, '/')}/${site.name}-access.log";
    error_log "${logsPath.replace(/\\/g, '/')}/${site.name}-error.log";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  SCRIPT_FILENAME  $document_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`

    if (site.ssl) {
      const sslPath = join(this.configStore.getSSLPath(), site.domain)
      config += `
server {
    listen 443 ssl http2;
    server_name ${site.domain};
    root "${site.rootPath.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    ssl_certificate "${sslPath.replace(/\\/g, '/')}/${site.domain}-chain.pem";
    ssl_certificate_key "${sslPath.replace(/\\/g, '/')}/${site.domain}-key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    access_log "${logsPath.replace(/\\/g, '/')}/${site.name}-ssl-access.log";
    error_log "${logsPath.replace(/\\/g, '/')}/${site.name}-ssl-error.log";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  SCRIPT_FILENAME  $document_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`
    }

    return config
  }

  private generateLaravelSiteConfig(site: SiteConfig): string {
    const logsPath = this.configStore.getLogsPath()
    // Laravel 项目 public 目录
    const publicPath = join(site.rootPath, 'public').replace(/\\/g, '/')

    let config = `
server {
    listen 80;
    server_name ${site.domain};
    root "${publicPath}";
    index index.php;

    access_log "${logsPath.replace(/\\/g, '/')}/${site.name}-access.log";
    error_log "${logsPath.replace(/\\/g, '/')}/${site.name}-error.log";

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    
    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_param  SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`

    if (site.ssl) {
      const sslPath = join(this.configStore.getSSLPath(), site.domain)
      config += `
server {
    listen 443 ssl http2;
    server_name ${site.domain};
    root "${publicPath}";
    index index.php;

    ssl_certificate "${sslPath.replace(/\\/g, '/')}/${site.domain}-chain.pem";
    ssl_certificate_key "${sslPath.replace(/\\/g, '/')}/${site.domain}-key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    access_log "${logsPath.replace(/\\/g, '/')}/${site.name}-ssl-access.log";
    error_log "${logsPath.replace(/\\/g, '/')}/${site.name}-ssl-error.log";

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    
    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_param  SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`
    }

    return config
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(dest)
      const protocol = url.startsWith('https') ? https : http

      const request = protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            file.close()
            unlinkSync(dest)
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
            sendDownloadProgress('nginx', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          sendDownloadProgress('nginx', 100, totalSize, totalSize)
          resolve()
        })
      })

      request.on('error', (err) => {
        file.close()
        if (existsSync(dest)) unlinkSync(dest)
        reject(err)
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

