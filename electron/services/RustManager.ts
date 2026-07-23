import { ConfigStore } from './ConfigStore'
import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

interface RustVersion {
  // toolchain 名，如 stable-x86_64-pc-windows-msvc / 1.97.0-x86_64-pc-windows-msvc
  version: string
  // 展示用的短名，如 stable / 1.97.0
  label: string
  // toolchain 安装目录（rustup toolchain list 给的路径）
  path: string
  isActive: boolean
  // 来源：rustup = rustup 管理的 toolchain；system = 系统其它位置（无 rustup 时 fallback）
  source: 'rustup' | 'system'
}

interface AvailableRustVersion {
  // 传给 rustup install 的名字：stable / beta / nightly / 1.97.0
  name: string
  // 展示标签
  label: string
  type: 'channel' | 'version'
  date?: string
}

export class RustManager {
  private configStore: ConfigStore

  constructor(configStore: ConfigStore) {
    this.configStore = configStore
  }

  /**
   * 托管根目录。Rust 由 rustup 管理，本应用不真正解压托管，这里仅保留目录约定
   * 以便与其它 Manager 对称（用于临时文件 / RUSTUP_HOME 备选等）。
   */
  getRustBasePath(): string {
    return join(this.configStore.getBasePath(), 'rust')
  }

  /**
   * 解析 rustup 可执行路径：优先常见固定位置，回退 PATH 里的 rustup。
   * 若用户用 mise 装 rustup，shim 在 %LOCALAPPDATA%\mise\shims\rustup.exe。
   */
  private resolveRustupExe(): string | null {
    const local = process.env.LOCALAPPDATA || ''
    const userprofile = process.env.USERPROFILE || ''
    const candidates = [
      join(local, 'mise', 'shims', 'rustup.exe'),
      join(userprofile, '.cargo', 'bin', 'rustup.exe'),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return 'rustup' // 交给系统在 PATH 里解析
  }

  private async run(cmd: string, timeout = 30000): Promise<string> {
    const { stdout } = await execAsync(cmd, { windowsHide: true, timeout })
    return stdout
  }

  /**
   * 获取已安装的 Rust toolchain（rustup toolchain list -v）。
   * 输出形如：stable-x86_64-pc-windows-msvc (active, default) C:\...\toolchains\stable-x86_64-pc-windows-msvc
   * 一行含 toolchain 名、(tags)、安装路径，一次解析即可。
   * active/default 行即当前默认 toolchain。
   * 若无 rustup，则探测系统 rustc/cargo 作 system 来源。
   */
  async getInstalledVersions(): Promise<RustVersion[]> {
    const versions: RustVersion[] = []
    const rustupExe = this.resolveRustupExe()

    if (rustupExe) {
      try {
        const out = await this.run(`"${rustupExe}" toolchain list -v`, 15000)
        for (const line of out.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed) continue
          // group1=toolchain名 group2=括号内tags(可含逗号) group3=安装路径
          const m = trimmed.match(/^(\S+)(?:\s+\(([^)]*)\))?(?:\s+(.+))?$/)
          if (!m) continue
          const full = m[1]
          const tags = m[2] || ''
          const path = (m[3] || '').trim()
          versions.push({
            version: full,
            label: full.replace(/-x86_64-pc-windows-msvc$/, ''),
            path,
            isActive: tags.includes('default') || tags.includes('active'),
            source: 'rustup',
          })
        }
      } catch {
        // rustup 不可用，落到 system 探测
      }
    }

    // 无 rustup 或 toolchain 列表为空时，探测系统 rustc 作 system 来源
    if (versions.length === 0) {
      const sys = await this.detectSystemRust()
      if (sys) {
        versions.push({
          version: sys.version,
          label: sys.version,
          path: sys.path,
          isActive: true,
          source: 'system',
        })
      }
    }

    return versions.sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }))
  }

  /**
   * 探测系统已安装的 Rust（无 rustup 时 fallback）。
   * 用 `rustc --version` 拿版本，`rustup which` 不可用时退而用 `where rustc` 取目录。
   */
  private async detectSystemRust(): Promise<{ version: string; path: string } | null> {
    try {
      const out = await this.run('rustc --version', 8000)
      const m = out.match(/rustc\s+([\d.]+)/)
      if (!m) return null
      const version = m[1]
      try {
        const wout = await this.run('where rustc', 5000)
        const rustcPath = wout.trim().split(/\r?\n/)[0] || ''
        if (rustcPath) {
          const dir = rustcPath.replace(/[\\/]bin[\\/][^\\/]+$/, '').replace(/[\\/]bin$/, '')
          return { version, path: dir }
        }
      } catch {}
      return { version, path: '' }
    } catch {
      return null
    }
  }

  /**
   * 可用版本列表：三个 channel + 历史点版本（取最近 N 个）。
   * channel 直接静态给出；历史版本从 rust-lang.org dist channel manifest 取。
   */
  async getAvailableVersions(): Promise<AvailableRustVersion[]> {
    const list: AvailableRustVersion[] = [
      { name: 'stable', label: 'stable（稳定版）', type: 'channel' },
      { name: 'beta', label: 'beta（测试版）', type: 'channel' },
      { name: 'nightly', label: 'nightly（每日构建）', type: 'channel' },
    ]

    try {
      const history = await this.fetchRecentReleases(20)
      for (const v of history) {
        list.push({ name: v.version, label: v.version, type: 'version', date: v.date })
      }
    } catch {
      // 取不到历史版本不影响 channel 列出
    }

    return list
  }

  /**
   * 取近期稳定版本号：从 GitHub rust-lang/rust releases 拿（权威历史版本源）。
   * 无 token 匿名访问有速率限制，但取一次缓存 5 分钟足够。失败则返回空，
   * 不影响 channel（stable/beta/nightly）的展示。
   */
  private async fetchRecentReleases(limit: number): Promise<{ version: string; date: string }[]> {
    const url = `https://api.github.com/repos/rust-lang/rust/releases?per_page=${limit}`
    const out = await this.run(
      `curl.exe -sL -H "Accept: application/vnd.github+json" -H "User-Agent: PHPer-Dev-Manager" ${url}`,
      20000,
    )
    const list: { version: string; date: string }[] = []
    try {
      const arr = JSON.parse(out) as Array<{
        tag_name?: string
        published_at?: string
        prerelease?: boolean
      }>
      for (const r of arr) {
        const v = (r.tag_name || '').trim()
        if (/^\d+\.\d+\.\d+$/.test(v) && !r.prerelease) {
          list.push({ version: v, date: (r.published_at || '').slice(0, 10) })
        }
      }
    } catch {
      // 解析失败返回已收集的（通常为空）
    }
    return list
  }

  /**
   * 安装 toolchain：rustup install <name>。
   * name 可以是 stable/beta/nightly 或具体点版本（如 1.97.0）。
   * 若本机无 rustup，返回引导提示。
   */
  async install(name: string): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe()
    if (!rustupExe) {
      return {
        success: false,
        message: '未检测到 rustup。请先安装 rustup（https://rustup.rs），或用 mise 安装：mise use -g rust@stable',
      }
    }
    try {
      const out = await this.run(`"${rustupExe}" install ${name}`, 600000)
      return { success: true, message: `Rust toolchain ${name} 安装成功\n${out.slice(-200)}` }
    } catch (e: any) {
      return { success: false, message: `安装失败: ${e.message}` }
    }
  }

  /** 卸载 toolchain：rustup uninstall <name>。 */
  async uninstall(name: string): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe()
    if (!rustupExe) return { success: false, message: '未检测到 rustup' }
    try {
      await this.run(`"${rustupExe}" uninstall ${name}`, 120000)
      return { success: true, message: `Rust toolchain ${name} 已卸载` }
    } catch (e: any) {
      return { success: false, message: `卸载失败: ${e.message}` }
    }
  }

  /** 设为默认 toolchain：rustup default <name>。 */
  async setActive(name: string): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe()
    if (!rustupExe) return { success: false, message: '未检测到 rustup' }
    try {
      await this.run(`"${rustupExe}" default ${name}`, 60000)
      this.configStore.set('activeRustVersion', name)
      return { success: true, message: `${name} 已设为默认 toolchain` }
    } catch (e: any) {
      return { success: false, message: `设置失败: ${e.message}` }
    }
  }

  /** 更新全部 toolchain：rustup update。 */
  async update(): Promise<{ success: boolean; message: string }> {
    const rustupExe = this.resolveRustupExe()
    if (!rustupExe) return { success: false, message: '未检测到 rustup' }
    try {
      const out = await this.run(`"${rustupExe}" update`, 600000)
      return { success: true, message: `更新完成\n${out.slice(-300)}` }
    } catch (e: any) {
      return { success: false, message: `更新失败: ${e.message}` }
    }
  }

  /** 检查 rustup 是否可用及其版本。 */
  async checkSystem(): Promise<{ installed: boolean; version?: string; rustcVersion?: string }> {
    const rustupExe = this.resolveRustupExe()
    try {
      const out = await this.run(`"${rustupExe || 'rustup'}" --version`, 8000)
      const m = out.match(/rustup\s+([\d.]+)/)
      let rustcVersion: string | undefined
      try {
        const r = await this.run('rustc --version', 8000)
        const rm = r.match(/rustc\s+([\d.]+)/)
        if (rm) rustcVersion = rm[1]
      } catch {}
      return { installed: true, version: m ? m[1] : 'unknown', rustcVersion }
    } catch {
      return { installed: false }
    }
  }
}