import { ConfigStore } from './ConfigStore'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, rmdirSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { createWriteStream } from 'fs'
import { sendDownloadProgress } from '../main'

const execAsync = promisify(exec)

interface GitVersion {
  version: string
  path: string
  isActive: boolean
}

interface AvailableGitVersion {
  version: string
  downloadUrl: string
  type: 'portable' | 'installer'
}

export class GitManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取 Git 安装路径
   */
  getGitPath(): string {
    return join(this.configStore.getBasePath(), 'git')
  }

  /**
   * 获取已安装的 Git 版本
   */
  async getInstalledVersions(): Promise<GitVersion[]> {
    const versions: GitVersion[] = []
    const gitPath = this.getGitPath()

    if (!existsSync(gitPath)) {
      return versions
    }

    // 检查是否存在 git.exe
    const gitExe = join(gitPath, 'cmd', 'git.exe')
    const gitExeAlt = join(gitPath, 'bin', 'git.exe')

    if (existsSync(gitExe) || existsSync(gitExeAlt)) {
      try {
        const exePath = existsSync(gitExe) ? gitExe : gitExeAlt
        const { stdout } = await execAsync(`"${exePath}" --version`, {
          windowsHide: true,
          timeout: 10000
        })
        const match = stdout.match(/git version (\d+\.\d+\.\d+)/)
        if (match) {
          versions.push({
            version: match[1],
            path: gitPath,
            isActive: true
          })
        }
      } catch (error: any) {
        console.error('获取 Git 版本失败:', error)
      }
    }

    return versions
  }

  /**
   * 获取可用的 Git 版本列表
   */
  async getAvailableVersions(): Promise<AvailableGitVersion[]> {
    // Git for Windows 便携版下载地址
    // https://github.com/git-for-windows/git/releases
    const versions: AvailableGitVersion[] = [
      {
        version: '2.47.1',
        downloadUrl: 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe',
        type: 'portable'
      },
      {
        version: '2.46.2',
        downloadUrl: 'https://github.com/git-for-windows/git/releases/download/v2.46.2.windows.1/PortableGit-2.46.2-64-bit.7z.exe',
        type: 'portable'
      },
      {
        version: '2.45.2',
        downloadUrl: 'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/PortableGit-2.45.2-64-bit.7z.exe',
        type: 'portable'
      }
    ]

    // 过滤掉已安装的版本
    const installed = await this.getInstalledVersions()
    const installedVersions = installed.map(v => v.version)

    return versions.filter(v => !installedVersions.includes(v.version))
  }

  /**
   * 安装 Git
   */
  async install(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions()
      const versionInfo = available.find(v => v.version === version)

      if (!versionInfo) {
        return { success: false, message: `未找到 Git ${version} 版本` }
      }

      const gitPath = this.getGitPath()
      const tempPath = this.configStore.getTempPath()
      const downloadPath = join(tempPath, `PortableGit-${version}.7z.exe`)

      // 确保目录存在
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true })
      }
      if (!existsSync(gitPath)) {
        mkdirSync(gitPath, { recursive: true })
      }

      console.log(`开始下载 Git ${version} 从 ${versionInfo.downloadUrl}`)

      // 下载 Git
      await this.downloadFile(versionInfo.downloadUrl, downloadPath)

      console.log('下载完成，开始解压...')

      // 解压便携版 Git（自解压 7z）
      // 使用命令行运行自解压程序
      try {
        await execAsync(`"${downloadPath}" -o"${gitPath}" -y`, {
          windowsHide: true,
          timeout: 300000 // 5分钟超时
        })
      } catch (error: any) {
        // 自解压可能不返回正确的退出码，检查文件是否存在
        const gitExe = join(gitPath, 'cmd', 'git.exe')
        const gitExeAlt = join(gitPath, 'bin', 'git.exe')
        if (!existsSync(gitExe) && !existsSync(gitExeAlt)) {
          throw new Error(`解压失败: ${error.message}`)
        }
      }

      console.log('解压完成')

      // 删除临时文件
      if (existsSync(downloadPath)) {
        unlinkSync(downloadPath)
      }

      // 添加到环境变量
      await this.addToPath()

      return { success: true, message: `Git ${version} 安装成功` }
    } catch (error: any) {
      console.error('Git 安装失败:', error)
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 Git
   */
  async uninstall(): Promise<{ success: boolean; message: string }> {
    try {
      const gitPath = this.getGitPath()

      if (!existsSync(gitPath)) {
        return { success: false, message: 'Git 未安装' }
      }

      // 从环境变量移除
      await this.removeFromPath()

      // 删除目录
      this.removeDirectory(gitPath)

      return { success: true, message: 'Git 已卸载' }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 检查系统是否已安装 Git
   */
  async checkSystemGit(): Promise<{ installed: boolean; version?: string; path?: string }> {
    try {
      const { stdout } = await execAsync('git --version', {
        windowsHide: true,
        timeout: 10000
      })
      const match = stdout.match(/git version (\d+\.\d+\.\d+)/)

      // 获取 git 路径
      try {
        const { stdout: wherePath } = await execAsync('where git', {
          windowsHide: true,
          timeout: 5000
        })
        const gitExePath = wherePath.trim().split('\n')[0]
        return {
          installed: true,
          version: match ? match[1] : 'unknown',
          path: gitExePath
        }
      } catch {
        return {
          installed: true,
          version: match ? match[1] : 'unknown'
        }
      }
    } catch {
      return { installed: false }
    }
  }

  /**
   * 获取 Git 配置
   */
  async getGitConfig(): Promise<{ name?: string; email?: string }> {
    try {
      let name: string | undefined
      let email: string | undefined

      try {
        const { stdout: nameOut } = await execAsync('git config --global user.name', {
          windowsHide: true,
          timeout: 5000
        })
        name = nameOut.trim()
      } catch {}

      try {
        const { stdout: emailOut } = await execAsync('git config --global user.email', {
          windowsHide: true,
          timeout: 5000
        })
        email = emailOut.trim()
      } catch {}

      return { name, email }
    } catch {
      return {}
    }
  }

  /**
   * 设置 Git 配置
   */
  async setGitConfig(name: string, email: string): Promise<{ success: boolean; message: string }> {
    try {
      if (name) {
        await execAsync(`git config --global user.name "${name}"`, {
          windowsHide: true,
          timeout: 5000
        })
      }

      if (email) {
        await execAsync(`git config --global user.email "${email}"`, {
          windowsHide: true,
          timeout: 5000
        })
      }

      return { success: true, message: 'Git 配置已保存' }
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

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
          file.close()
          if (existsSync(dest)) unlinkSync(dest)
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
            sendDownloadProgress('git', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          sendDownloadProgress('git', 100, totalSize, totalSize)
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

      request.setTimeout(600000, () => {
        request.destroy()
        file.close()
        if (existsSync(dest)) unlinkSync(dest)
        reject(new Error('下载超时（10分钟）'))
      })
    })
  }

  private async addToPath(): Promise<void> {
    try {
      const gitPath = this.getGitPath()
      const cmdPath = join(gitPath, 'cmd')
      const binPath = join(gitPath, 'bin')

      const tempScriptPath = join(this.configStore.getTempPath(), 'add_git_path.ps1')
      mkdirSync(this.configStore.getTempPath(), { recursive: true })

      const psScript = `
param([string]$CmdPath, [string]$BinPath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { $userPath = '' }

$paths = $userPath -split ';' | Where-Object { $_ -ne '' -and $_.Trim() -ne '' }

# 移除旧的 Git 路径
$filteredPaths = @()
foreach ($p in $paths) {
    $pathLower = $p.ToLower()
    if (-not ($pathLower -like '*\\git\\*' -or $pathLower -like '*\\git-*')) {
        $filteredPaths += $p
    }
}

# 添加新路径
$allPaths = @($CmdPath, $BinPath) + $filteredPaths
$newPath = $allPaths -join ';'

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
Write-Host "SUCCESS: Git path added"
`

      writeFileSync(tempScriptPath, psScript, 'utf-8')

      await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -CmdPath "${cmdPath}" -BinPath "${binPath}"`,
        { windowsHide: true, timeout: 30000 }
      )

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath)
      }
    } catch (error: any) {
      console.error('添加 Git 到 PATH 失败:', error)
    }
  }

  private async removeFromPath(): Promise<void> {
    try {
      const gitPath = this.getGitPath()

      const tempScriptPath = join(this.configStore.getTempPath(), 'remove_git_path.ps1')
      mkdirSync(this.configStore.getTempPath(), { recursive: true })

      const psScript = `
param([string]$GitBasePath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { exit 0 }

$gitPathLower = $GitBasePath.ToLower()
$paths = $userPath -split ';' | Where-Object { 
    $_ -ne '' -and -not $_.ToLower().StartsWith($gitPathLower)
}
$newPath = $paths -join ';'

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
Write-Host "SUCCESS: Git path removed"
`

      writeFileSync(tempScriptPath, psScript, 'utf-8')

      await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -GitBasePath "${gitPath}"`,
        { windowsHide: true, timeout: 30000 }
      )

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath)
      }
    } catch (error: any) {
      console.error('从 PATH 移除 Git 失败:', error)
    }
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

