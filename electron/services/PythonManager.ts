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

interface PythonVersion {
  version: string
  path: string
  isActive: boolean
}

interface AvailablePythonVersion {
  version: string
  downloadUrl: string
  type: 'embed' | 'installer'
}

export class PythonManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 获取 Python 基础安装路径
   */
  getPythonBasePath(): string {
    return join(this.configStore.getBasePath(), 'python')
  }

  /**
   * 获取指定版本的 Python 路径
   */
  getPythonPath(version: string): string {
    return join(this.getPythonBasePath(), `python-${version}`)
  }

  /**
   * 获取已安装的 Python 版本
   */
  async getInstalledVersions(): Promise<PythonVersion[]> {
    const versions: PythonVersion[] = []
    const pythonBasePath = this.getPythonBasePath()
    const activeVersion = this.configStore.get('activePythonVersion') as string || ''

    if (!existsSync(pythonBasePath)) {
      return versions
    }

    const dirs = readdirSync(pythonBasePath, { withFileTypes: true })
    
    for (const dir of dirs) {
      if (dir.isDirectory() && dir.name.startsWith('python-')) {
        const version = dir.name.replace('python-', '')
        const pythonPath = join(pythonBasePath, dir.name)
        const pythonExe = join(pythonPath, 'python.exe')

        if (existsSync(pythonExe)) {
          versions.push({
            version,
            path: pythonPath,
            isActive: version === activeVersion
          })
        }
      }
    }

    return versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))
  }

  /**
   * 获取可用的 Python 版本列表
   * 使用 Python 嵌入式版本（免安装）
   */
  async getAvailableVersions(): Promise<AvailablePythonVersion[]> {
    // Python 嵌入式版本下载地址
    // https://www.python.org/downloads/windows/
    const versions: AvailablePythonVersion[] = [
      {
        version: '3.13.1',
        downloadUrl: 'https://www.python.org/ftp/python/3.13.1/python-3.13.1-embed-amd64.zip',
        type: 'embed'
      },
      {
        version: '3.12.8',
        downloadUrl: 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip',
        type: 'embed'
      },
      {
        version: '3.11.11',
        downloadUrl: 'https://www.python.org/ftp/python/3.11.11/python-3.11.11-embed-amd64.zip',
        type: 'embed'
      },
      {
        version: '3.10.16',
        downloadUrl: 'https://www.python.org/ftp/python/3.10.16/python-3.10.16-embed-amd64.zip',
        type: 'embed'
      },
      {
        version: '3.9.21',
        downloadUrl: 'https://www.python.org/ftp/python/3.9.21/python-3.9.21-embed-amd64.zip',
        type: 'embed'
      }
    ]

    // 过滤掉已安装的版本
    const installed = await this.getInstalledVersions()
    const installedVersions = installed.map(v => v.version)

    return versions.filter(v => !installedVersions.includes(v.version))
  }

  /**
   * 安装 Python
   */
  async install(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const available = await this.getAvailableVersions()
      const versionInfo = available.find(v => v.version === version)

      if (!versionInfo) {
        return { success: false, message: `未找到 Python ${version} 版本` }
      }

      const pythonPath = this.getPythonPath(version)
      const tempPath = this.configStore.getTempPath()
      const zipPath = join(tempPath, `python-${version}.zip`)

      // 确保目录存在
      if (!existsSync(tempPath)) {
        mkdirSync(tempPath, { recursive: true })
      }
      if (!existsSync(pythonPath)) {
        mkdirSync(pythonPath, { recursive: true })
      }

      console.log(`开始下载 Python ${version} 从 ${versionInfo.downloadUrl}`)

      // 下载 Python
      await this.downloadFile(versionInfo.downloadUrl, zipPath)

      console.log('下载完成，开始解压...')

      // 解压
      await this.unzip(zipPath, pythonPath)

      console.log('解压完成')

      // 删除临时文件
      if (existsSync(zipPath)) {
        unlinkSync(zipPath)
      }

      // 配置 pip（嵌入式版本需要额外配置）
      await this.setupPip(pythonPath, version)

      // 如果是第一个安装的版本，设为默认
      const installed = await this.getInstalledVersions()
      if (installed.length === 1) {
        await this.setActive(version)
      }

      return { success: true, message: `Python ${version} 安装成功` }
    } catch (error: any) {
      console.error('Python 安装失败:', error)
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  /**
   * 卸载 Python
   */
  async uninstall(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const pythonPath = this.getPythonPath(version)

      if (!existsSync(pythonPath)) {
        return { success: false, message: `Python ${version} 未安装` }
      }

      // 如果是当前活动版本，清除
      const activeVersion = this.configStore.get('activePythonVersion')
      if (activeVersion === version) {
        await this.removeFromPath(pythonPath)
        this.configStore.set('activePythonVersion' as any, '')
      }

      // 删除目录
      this.removeDirectory(pythonPath)

      return { success: true, message: `Python ${version} 已卸载` }
    } catch (error: any) {
      return { success: false, message: `卸载失败: ${error.message}` }
    }
  }

  /**
   * 设置活动的 Python 版本
   */
  async setActive(version: string): Promise<{ success: boolean; message: string }> {
    try {
      const pythonPath = this.getPythonPath(version)

      if (!existsSync(pythonPath)) {
        return { success: false, message: `Python ${version} 未安装` }
      }

      const pythonExe = join(pythonPath, 'python.exe')
      if (!existsSync(pythonExe)) {
        return { success: false, message: `Python ${version} 安装不完整` }
      }

      // 添加到环境变量
      await this.addToPath(pythonPath)

      // 更新配置
      this.configStore.set('activePythonVersion' as any, version)

      return {
        success: true,
        message: `Python ${version} 已设置为默认版本\n\n环境变量已更新，新开的终端窗口中将生效。`
      }
    } catch (error: any) {
      return { success: false, message: `设置失败: ${error.message}` }
    }
  }

  /**
   * 检查系统是否已安装 Python
   */
  async checkSystemPython(): Promise<{ installed: boolean; version?: string; path?: string }> {
    try {
      const { stdout } = await execAsync('python --version', {
        windowsHide: true,
        timeout: 10000
      })
      const match = stdout.match(/Python (\d+\.\d+\.\d+)/)

      try {
        const { stdout: wherePath } = await execAsync('where python', {
          windowsHide: true,
          timeout: 5000
        })
        const pythonExePath = wherePath.trim().split('\n')[0]
        return {
          installed: true,
          version: match ? match[1] : 'unknown',
          path: pythonExePath
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
   * 获取 pip 信息
   */
  async getPipInfo(version: string): Promise<{ installed: boolean; version?: string }> {
    try {
      const pythonPath = this.getPythonPath(version)
      const pythonExe = join(pythonPath, 'python.exe')

      const { stdout } = await execAsync(`"${pythonExe}" -m pip --version`, {
        windowsHide: true,
        timeout: 10000
      })
      const match = stdout.match(/pip (\d+\.\d+(?:\.\d+)?)/)

      return {
        installed: true,
        version: match ? match[1] : 'unknown'
      }
    } catch {
      return { installed: false }
    }
  }

  /**
   * 安装 pip 包
   */
  async installPackage(version: string, packageName: string): Promise<{ success: boolean; message: string }> {
    try {
      const pythonPath = this.getPythonPath(version)
      const pythonExe = join(pythonPath, 'python.exe')

      const { stdout, stderr } = await execAsync(
        `"${pythonExe}" -m pip install ${packageName}`,
        {
          windowsHide: true,
          timeout: 300000 // 5分钟
        }
      )

      console.log('pip install output:', stdout)
      if (stderr) console.log('pip install stderr:', stderr)

      return { success: true, message: `${packageName} 安装成功` }
    } catch (error: any) {
      return { success: false, message: `安装失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 配置 pip（嵌入式版本需要额外配置）
   */
  private async setupPip(pythonPath: string, version: string): Promise<void> {
    try {
      // 修改 python*._pth 文件以启用 pip
      const majorMinor = version.split('.').slice(0, 2).join('')
      const pthFile = join(pythonPath, `python${majorMinor}._pth`)
      
      if (existsSync(pthFile)) {
        const { readFileSync } = require('fs')
        let content = readFileSync(pthFile, 'utf-8')
        // 取消注释 import site
        content = content.replace(/^#import site/m, 'import site')
        writeFileSync(pthFile, content)
        console.log('已启用 site 模块')
      }

      // 下载并安装 pip
      const pythonExe = join(pythonPath, 'python.exe')
      const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py'
      const getPipPath = join(pythonPath, 'get-pip.py')

      console.log('下载 get-pip.py...')
      await this.downloadFile(getPipUrl, getPipPath)

      console.log('安装 pip...')
      try {
        await execAsync(`"${pythonExe}" "${getPipPath}"`, {
          cwd: pythonPath,
          windowsHide: true,
          timeout: 300000
        })
        console.log('pip 安装成功')
      } catch (e: any) {
        console.log('pip 安装提示:', e.message)
        // pip 可能已经安装成功，忽略某些错误
      }

      // 清理
      if (existsSync(getPipPath)) {
        unlinkSync(getPipPath)
      }
    } catch (error: any) {
      console.error('pip 配置失败:', error)
      // 不抛出错误，pip 配置失败不影响 Python 使用
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
            sendDownloadProgress('python', progress, downloadedSize, totalSize)
            lastProgressTime = now
          }
        })

        response.pipe(file)
        file.on('finish', () => {
          file.close()
          sendDownloadProgress('python', 100, totalSize, totalSize)
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

  private async addToPath(pythonPath: string): Promise<void> {
    try {
      const scriptsPath = join(pythonPath, 'Scripts')

      const tempScriptPath = join(this.configStore.getTempPath(), 'add_python_path.ps1')
      mkdirSync(this.configStore.getTempPath(), { recursive: true })

      const psScript = `
param([string]$PythonPath, [string]$ScriptsPath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { $userPath = '' }

$paths = $userPath -split ';' | Where-Object { $_ -ne '' -and $_.Trim() -ne '' }

# 移除旧的 Python 路径
$filteredPaths = @()
foreach ($p in $paths) {
    $pathLower = $p.ToLower()
    if (-not ($pathLower -like '*\\python\\python-*' -or $pathLower -like '*\\python-*\\*')) {
        $filteredPaths += $p
    }
}

# 添加新路径
$allPaths = @($PythonPath, $ScriptsPath) + $filteredPaths
$newPath = $allPaths -join ';'

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
Write-Host "SUCCESS: Python path added"
`

      writeFileSync(tempScriptPath, psScript, 'utf-8')

      await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -PythonPath "${pythonPath}" -ScriptsPath "${scriptsPath}"`,
        { windowsHide: true, timeout: 30000 }
      )

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath)
      }
    } catch (error: any) {
      console.error('添加 Python 到 PATH 失败:', error)
    }
  }

  private async removeFromPath(pythonPath: string): Promise<void> {
    try {
      const tempScriptPath = join(this.configStore.getTempPath(), 'remove_python_path.ps1')
      mkdirSync(this.configStore.getTempPath(), { recursive: true })

      const psScript = `
param([string]$PythonBasePath)

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($userPath -eq $null) { exit 0 }

$pythonPathLower = $PythonBasePath.ToLower()
$paths = $userPath -split ';' | Where-Object { 
    $_ -ne '' -and -not $_.ToLower().StartsWith($pythonPathLower)
}
$newPath = $paths -join ';'

[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
Write-Host "SUCCESS: Python path removed"
`

      writeFileSync(tempScriptPath, psScript, 'utf-8')

      await execAsync(
        `powershell -ExecutionPolicy Bypass -File "${tempScriptPath}" -PythonBasePath "${pythonPath}"`,
        { windowsHide: true, timeout: 30000 }
      )

      if (existsSync(tempScriptPath)) {
        unlinkSync(tempScriptPath)
      }
    } catch (error: any) {
      console.error('从 PATH 移除 Python 失败:', error)
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

