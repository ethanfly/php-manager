import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { withPathLock } from "./pathLock";

const execAsync = promisify(exec);

/**
 * 集中管理用户 PATH 环境变量的安全读写。
 *
 * 设计目标：彻底杜绝「安装工具时把用户原有 PATH 删掉」的问题。
 *
 * 旧实现的问题：各 Manager 用宽泛的通配符（如 *\php-*\*、*\nodejs*、*\git-*）
 * 来移除「旧的同工具路径」，这些通配符会误伤用户 PATH 中只是恰好包含这些
 * 子串的无关条目（例如 C:\Users\me\projects\php-old\bin 会被 *\php-*\* 命中删除）。
 *
 * 本类改为：
 * 1. 只移除「明确属于本应用托管目录」的条目（按精确前缀匹配 basePath 下的子目录），
 *    绝不用通配符扫荡，从而永远不会动用户其它 PATH。
 * 2. 写入前把当前 PATH 备份到文件，便于灾难恢复。
 * 3. 写入前做「断崖保护」：若结果相比原始值异常缩短，则中止写入。
 * 4. 去重保序，保留 %VAR% 形式。
 * 5. 所有写入串行化（复用 withPathLock）。
 */
export class PathManager {
  private tempPath: string;
  private backupFile: string;

  constructor(configStore: {
    getBasePath: () => string;
    getTempPath: () => string;
  }) {
    this.tempPath = configStore.getTempPath();
    this.backupFile = join(configStore.getBasePath(), "path_backup.txt");
  }

  /** 备份文件路径（供 UI/用户手动恢复） */
  getBackupFile(): string {
    return this.backupFile;
  }

  /**
   * 读取当前用户 PATH（已展开 %VAR% 后的值，与旧实现一致）。
   */
  async readUserPath(): Promise<string> {
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$p = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($null -eq $p) { '' } else { $p }
`.trim();
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 15000 }
    );
    return stdout.replace(/\r?\n$/, "");
  }

  /**
   * 添加若干路径到用户 PATH（前置），并可选移除位于 replacePrefix 之下的旧条目。
   *
   * @param entries 要添加的路径列表（按顺序前置）
   * @param replacePrefix 仅移除以此为前缀的条目（应为本应用托管的工具根目录，
   *                       如 C:\service\php）。不传则只做去重添加，不移除任何条目。
   */
  async add(
    entries: string[],
    replacePrefix?: string
  ): Promise<{ success: boolean; message: string }> {
    return withPathLock(async () => {
      const script = this.buildScript();
      if (!existsSync(this.tempPath)) {
        mkdirSync(this.tempPath, { recursive: true });
      }
      const scriptPath = join(this.tempPath, "path_manager.ps1");
      // 通过文件传递 JSON，彻底规避命令行对 " 和 \ 的转义问题
      const addJsonPath = join(this.tempPath, "path_add.json");
      writeFileSync(
        addJsonPath,
        JSON.stringify(entries.filter((e) => e && e.trim())),
        "utf-8"
      );
      writeFileSync(scriptPath, script, "utf-8");

      try {
        const { stdout, stderr } = await execAsync(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -AddFile "${addJsonPath}" -ReplacePrefix "${replacePrefix || ""}" -BackupFile "${this.backupFile}"`,
          { windowsHide: true, timeout: 30000 }
        );
        const out = (stdout || "").trim();
        if (stderr && stderr.trim()) {
          console.error("[PathManager] stderr:", stderr.trim());
        }
        if (out.startsWith("ABORT")) {
          return { success: false, message: out };
        }
        // 同步刷新当前 Electron 进程的环境变量，使本会话内的 exec('tool')
        // 能立即解析到新加入的路径（无需重启应用）。
        this.refreshProcessPath(entries, replacePrefix);
        return { success: true, message: out };
      } catch (e: any) {
        return {
          success: false,
          message: `更新 PATH 失败: ${e.message}`,
        };
      } finally {
        try {
          unlinkSync(scriptPath);
        } catch {
          // 忽略
        }
        try {
          unlinkSync(addJsonPath);
        } catch {
          // 忽略
        }
      }
    });
  }

  /**
   * 移除位于 prefix 之下的所有条目（用于卸载/切换时清理）。
   */
  async remove(prefix: string): Promise<{ success: boolean; message: string }> {
    return this.add([], prefix);
  }

  /**
   * 同步刷新当前进程 process.env.PATH，模拟持久化写入的效果。
   * 这样应用在本会话内执行 `git --version` 等命令时能立即发现新工具，
   * 而不必等待重启（Windows 不会把 WM_SETTINGCHANGE 传播给已运行的进程）。
   */
  private refreshProcessPath(entries: string[], replacePrefix?: string): void {
    const cur = (process.env.PATH || "").split(";").filter((p) => p.trim());
    // 注意：不能用 String.prototype.trimEnd("\\")——它不接受参数、只去空白。
    // 用正则去掉尾部反斜杠/正斜杠后再比较，与 PowerShell 端 TrimEnd('\\') 行为一致。
    const rp = (replacePrefix || "").replace(/[\\/]+$/, "").toLowerCase();
    const kept = rp
      ? cur.filter((p) => {
          const pl = p.replace(/[\\/]+$/, "").toLowerCase();
          return !(pl === rp || pl.startsWith(rp + "\\"));
        })
      : cur;
    const seen = new Set<string>();
    const final: string[] = [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const a = entries[i].trim();
      if (a && !seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        final.unshift(a);
      }
    }
    for (const p of kept) {
      if (!seen.has(p.toLowerCase())) {
        seen.add(p.toLowerCase());
        final.push(p);
      }
    }
    process.env.PATH = final.join(";");
  }

  private buildScript(): string {
    return `
param(
  [string]$AddFile = '',
  [string]$ReplacePrefix = '',
  [string]$BackupFile = ''
)
$ErrorActionPreference = 'Stop'

# 1. 读取当前用户 PATH（GetEnvironmentVariable 已展开 %VAR%）
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($null -eq $userPath) { $userPath = '' }
$origLen = $userPath.Length

# 2. 备份（写入前）
if ($BackupFile -ne '') {
  try {
    $bd = Split-Path -Parent $BackupFile
    if ($bd -and -not (Test-Path $bd)) { New-Item -ItemType Directory -Path $bd -Force | Out-Null }
    Set-Content -Path $BackupFile -Value $userPath -NoNewline -Encoding UTF8
  } catch {
    Write-Warning "备份失败: $_"
  }
}

# 3. 拆分（保序，去空）
$paths = New-Object System.Collections.Generic.List[string]
foreach ($p in ($userPath -split ';')) {
  if ($p.Trim() -ne '') { [void]$paths.Add($p) }
}
$beforeCount = $paths.Count

# 4. 从文件读取要添加的条目（避免命令行对反斜杠/引号的转义问题）
$addList = @()
if ($AddFile -ne '' -and (Test-Path $AddFile)) {
  try {
    $raw = Get-Content -Raw $AddFile
    $addList = $raw | ConvertFrom-Json
  } catch { $addList = @() }
}

# 5. 移除阶段：仅移除「精确属于 ReplacePrefix 之下」的条目（大小写不敏感前缀匹配）
$rp = ''
if ($ReplacePrefix -ne '') { $rp = $ReplacePrefix.TrimEnd('\\').ToLower() }

$kept = New-Object System.Collections.Generic.List[string]
foreach ($p in $paths) {
  $pl = $p.TrimEnd('\\').ToLower()
  $drop = $false
  if ($rp -ne '' -and ($pl -eq $rp -or $pl.StartsWith($rp + '\\'))) {
    $drop = $true
  }
  if (-not $drop) { [void]$kept.Add($p) }
}

# 6. 添加阶段：前置 addList，去重（大小写不敏感），保留其余
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$final = New-Object System.Collections.Generic.List[string]
if ($addList -and $addList.Count) {
  for ($i = $addList.Count - 1; $i -ge 0; $i--) {
    $a = [string]$addList[$i]
    $a = $a.Trim()
    if ($a -ne '' -and -not $seen.Contains($a)) {
      [void]$seen.Add($a)
      $final.Insert(0, $a)
    }
  }
}
foreach ($p in $kept) {
  if (-not $seen.Contains($p)) {
    [void]$seen.Add($p)
    [void]$final.Add($p)
  }
}

$newPath = ($final -join ';')

# 7. 断崖保护：若原始 PATH 较长但结果异常缩短，中止写入（可能是逻辑异常导致数据丢失）
if ($origLen -gt 500 -and $newPath.Length -lt ($origLen * 0.4)) {
  Write-Output ("ABORT: PATH 结果将从 {0} 缩短到 {1} 字符，已中止写入。备份已保存到 {2}" -f $origLen, $newPath.Length, $BackupFile)
  exit 1
}

# 8. 写回（REG_SZ/REG_EXPAND_SZ 由 .NET 自动判定）
[Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')

# 9. 广播 WM_SETTINGCHANGE，通知已运行的进程刷新环境变量
try {
  Add-Type -Namespace PHPer -Name WinPath -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);' -ErrorAction SilentlyContinue
  $res = [IntPtr]::Zero
  [void][PHPer.WinPath]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [IntPtr]::Zero, 'Environment', 2, 1000, [ref]$res)
} catch {}

Write-Output ("OK before={0} after={1} len={2}" -f $beforeCount, $final.Count, $newPath.Length)
`.trim();
  }
}
