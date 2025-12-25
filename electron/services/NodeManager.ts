import { ConfigStore } from './ConfigStore'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import unzipper from 'unzipper'
import { sendDownloadProgress } from '../main'

const execAsync = promisify(exec)

interface NodeVersion {
  version: string
  path: string
  isActive: boolean
  npmVersion?: string
}

interface AvailableNodeVersion {
  version: string
  date: string
  lts: string | false
  security: boolean
  downloadUrl: string
}

export class NodeManager {
  private configStore: ConfigStore
  private versionsCache: AvailableNodeVersion[] = []
  private cacheTime: number = 0
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 分钟缓存

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取已安装的 Node.js 版本
   */
  async getInstalledVersions(): Promise<NodeVersion[]> {
    const versions: NodeVersion[] = []
    const nodePath = this.configStore.getNodePath()

    if (!existsSync(nodePath)) {
      return versions
    }

    const dirs = readdirSync(nodePath, { withFileTypes: true })
    const activeVersion = this.configStore.get('activeNodeVersion') || ''

    for (const dir of dirs) {
      if (dir.isDirectory() && dir.name.startsWith('node-')) {
        const versionDir = join(nodePath, dir.name)
        const nodeExe = join(versionDir, 'node.exe')

        if (existsSync(nodeExe)) {
          const version = dir.name.replace('node-', '').replace('-win-x64', '')
          let npmVersion = ''

          // 尝试获取 npm 版本
          try {
            const npmPath = join(versionDir, 'npm.cmd')
            if (existsSync(npmPath)) {
              const { stdout } = await execAsync(`"${npmPath}" --version`, { timeout: 5000 })
              npmVersion = stdout.trim()
            }
          } catch (e) {
            // 忽略错误
          }

          versions.push({
            version,
            path: versionDir,
            isActive: version === activeVersion,
            npmVersion
          })
        }
      }
    }

    // 按版本号排序（降序）
    versions.sort((a, b) => {
      const aParts = a.version.replace('v', '').split('.').map(Number)
      const bParts = b.version.replace('v', '').split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) {
          return bParts[i] - aParts[i]
        }
      }
      return 0
    })

    return versions
  }

  /**
   * 获取可用的 Node.js 版本列表
   */
  async getAvailableVersions(): Promise<AvailableNodeVersion[]> {
    // 检查缓存
    if (this.versionsCache.length > 0 && Date.now() - this.cacheTime < this.CACHE_DURATION) {
      return this.versionsCache
    }

    try {
      const versions = await this.fetchVersionsFromNodejs()
      if (versions.length > 0) {
        this.versionsCache = versions
        this.cacheTime = Date.now()
        return versions
      }
    } catch (error) {
      console.error('获取 Node.js 版本列表失败:', error)
    }

    // 返回硬编码的版本列表作为后备
    return this.getFallbackVersions()
  }

  /**
   * 从 Node.js 官网获取版本列表
   */
  private async fetchVersionsFromNodejs(): Promise<AvailableNodeVersion[]> {
    return new Promise((resolve, reject) => {
      const url = 'https://nodejs.org/dist/index.json'

      https.get(url, {
        headers: {
          'User-Agent': 'PHPer-Dev-Manager/1.0'
        },
        timeout: 30000
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            https.get(redirectUrl, (redirectRes) => {
              this.handleVersionResponse(redirectRes, resolve, reject)
            }).on('error', reject)
            return
          }
        }
        this.handleVersionResponse(res, resolve, reject)
      }).on('error', reject)
        .on('timeout', () => reject(new Error('请求超时')))
    })
  }

  private handleVersionResponse(res: http.IncomingMessage, resolve: Function, reject: Function) {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => {
      try {
        const versions = JSON.parse(data)
        const availableVersions: AvailableNodeVersion[] = []

        for (const v of versions) {
          // 只获取有 Windows 64位版本的
          if (v.files && v.files.includes('win-x64-zip')) {
            availableVersions.push({
              version: v.version,
              date: v.date,
              lts: v.lts,
              security: v.security,
              downloadUrl: `https://nodejs.org/dist/${v.version}/node-${v.version}-win-x64.zip`
            })
          }
        }

        // 只返回前 30 个版本
        resolve(availableVersions.slice(0, 30))
      } catch (e) {
        reject(e)
      }
    })
    res.on('error', reject)
  }

  /**
   * 安装 Node.js 版本
   */
  async install(version: string, downloadUrl: string): Promise<{ success: boolean; message: string }> {
    try {
      const nodePath = this.configStore.getNodePath()
      const tempPath = this.configStore.getTempPath()
      const zipPath = join(tempPath, `node-${version}.zip`)
      const extractDir = join(nodePath, `node-${version}-win-x64`)

      // 确保目录存在
      if (!existsSync(nodePath)) {
        mkdirSync(nodePath, { recursive: true })
      }
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true })
      }

      // 检查是否已安装
      if (existsSync(extractDir) && existsSync(join(extractDir, 'node.exe'))) {
        return { success: false, message: `Node.js ${version} 已安装` }
      }

      // 下载
      console.log(`开始下载 Node.js ${version}...`)
      await this.downloadFile(downloadUrl, zipPath, `node-${version}`)

      // 解压
      console.log(`开始解压 Node.js ${version}...`)
      await this.extractZip(zipPath, nodePath)

      // 清理下载文件
      try {
        unlinkSync(zipPath)
      } catch (e) {
        // 忽略清理错误
      }

      // 验证安装
      if (!existsSync(join(extractDir, 'node.exe'))) {
        return { success: false, message: '安装失败：node.exe 不存在' }
      }

      // 更新配置
      const nodeVersions = this.configStore.get('nodeVersions') || []
      if (!nodeVersions.includes(version)) {
        nodeVersions.push(version)
        this.configStore.set('nodeVersions', nodeVersions)
      }

      // 如果是第一个版本，设为默认
      if (nodeVersions.length === 1) {
        await this.setActive(version)
      }

      return { success: true, message: `Node.js ${version} 安装成功` }
    } catch (error: any) {
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 Node.js 版本
   */
  async uninstall(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const nodePath = this.configStore.getNodePath()
      const versionDir = join(nodePath, `node-${version}-win-x64`)

      if (!existsSync(versionDir)) {
        return { success: false, message: `Node.js ${version} 未安装` }
      }

      // 如果是当前激活的版本，先取消激活
      const activeVersion = this.configStore.get('activeNodeVersion')
      if (activeVersion === version) {
        this.configStore.set('activeNodeVersion', '')
      }

      // 删除目录
      rmSync(versionDir, { recursive: true, force: true })

      // 更新配置
      const nodeVersions = this.configStore.get('nodeVersions') || []
      const index = nodeVersions.indexOf(version)
      if (index > -1) {
        nodeVersions.splice(index, 1)
        this.configStore.set('nodeVersions', nodeVersions)
      }

      return { success: true, message: `Node.js ${version} 已卸载` }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 设置活动的 Node.js 版本
   */
  async setActive(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const nodePath = this.configStore.getNodePath()
      const versionDir = join(nodePath, `node-${version}-win-x64`)

      if (!existsSync(join(versionDir, 'node.exe'))) {
        return { success: false, message: `Node.js ${version} 未安装` }
      }

      // 添加到 PATH
      await this.addToPath(versionDir)

      // 更新配置
      this.configStore.set('activeNodeVersion', version)

      return { success: true, message: `已将 Node.js ${version} 设为默认版本` }
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` }
    }
  }

  /**
   * 获取 Node.js 信息
   */
  async getNodeInfo(version: string): Promise<any> {
    const nodePath = this.configStore.getNodePath()
    const versionDir = join(nodePath, `node-${version}-win-x64`)
    const nodeExe = join(versionDir, 'node.exe')

    if (!existsSync(nodeExe)) {
      return null
    }

    try {
      const { stdout: nodeVersion } = await execAsync(`"${nodeExe}" --version`, { timeout: 5000 })
      
      let npmVersion = ''
      const npmCmd = join(versionDir, 'npm.cmd')
      if (existsSync(npmCmd)) {
        const { stdout } = await execAsync(`"${npmCmd}" --version`, { timeout: 5000 })
        npmVersion = stdout.trim()
      }

      return {
        nodeVersion: nodeVersion.trim(),
        npmVersion,
        path: versionDir
      }
    } catch (error) {
      return null
    }
  }

  // ==================== 私有方法 ====================

  private async downloadFile(url: string, dest: string, name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http

      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'PHPer-Dev-Manager/1.0'
        },
        timeout: 600000 // 10 分钟超时
      }, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            this.downloadFile(redirectUrl, dest, name).then(resolve).catch(reject)
            return
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${response.statusCode}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0

        const file = createWriteStream(dest)

        let lastProgressTime = 0
        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          const now = Date.now()
          if (now - lastProgressTime > 500) {
            const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
            sendDownloadProgress('nodejs', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          sendDownloadProgress('nodejs', 100, totalSize, totalSize)
          resolve()
        })

        file.on('error', (err) => {
          unlinkSync(dest)
          reject(err)
        })
      })

      request.on('error', reject)
      request.on('timeout', () => {
        request.destroy()
        reject(new Error('下载超时'))
      })
    })
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = require('fs').createReadStream(zipPath)
      readStream
        .pipe(unzipper.Extract({ path: destDir }))
        .on('close', resolve)
        .on('error', reject)
    })
  }

  private async addToPath(nodePath: string): Promise<void> {
    // 使用 PowerShell 更新用户 PATH
    const psScript = `
$ErrorActionPreference = 'Stop'
$newPath = '${nodePath.replace(/\\/g, '\\\\')}'

# Get current user PATH
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathArray = $currentPath -split ';' | Where-Object { $_ -ne '' }

# Remove existing Node.js paths (from this manager and common locations)
$filteredPaths = $pathArray | Where-Object { 
  $p = $_.ToLower()
  -not ($p -like '*\\node-v*' -or 
        $p -like '*\\nodejs*' -or 
        $p -like '*phper-dev-manager*node*' -or
        $p -like '*\\nvm\\*')
}

# Add new path at the beginning
$newPathArray = @($newPath) + $filteredPaths

# Join and set
$finalPath = ($newPathArray | Select-Object -Unique) -join ';'
[Environment]::SetEnvironmentVariable('Path', $finalPath, 'User')

Write-Output "PATH updated successfully"
`

    const tempPs1 = join(this.configStore.getTempPath(), 'update_node_path.ps1')
    writeFileSync(tempPs1, psScript, 'utf-8')

    try {
      await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempPs1}"`, { timeout: 30000 })
    } finally {
      try {
        unlinkSync(tempPs1)
      } catch (e) {
        // 忽略
      }
    }
  }

  private getFallbackVersions(): AvailableNodeVersion[] {
    return [
      { version: 'v22.12.0', date: '2024-12-03', lts: false, security: false, downloadUrl: 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip' },
      { version: 'v22.11.0', date: '2024-10-29', lts: 'Jod', security: false, downloadUrl: 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip' },
      { version: 'v20.18.1', date: '2024-11-21', lts: 'Iron', security: false, downloadUrl: 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip' },
      { version: 'v20.18.0', date: '2024-10-03', lts: 'Iron', security: false, downloadUrl: 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip' },
      { version: 'v18.20.5', date: '2024-11-21', lts: 'Hydrogen', security: false, downloadUrl: 'https://nodejs.org/dist/v18.20.5/node-v18.20.5-win-x64.zip' },
      { version: 'v18.20.4', date: '2024-08-21', lts: 'Hydrogen', security: true, downloadUrl: 'https://nodejs.org/dist/v18.20.4/node-v18.20.4-win-x64.zip' },
    ]
  }
}

