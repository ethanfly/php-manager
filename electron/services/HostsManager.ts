import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import sudo from 'sudo-prompt'

const execAsync = promisify(exec)

const sudoExec = (command: string, name: string): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    sudo.exec(command, { name }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve({ stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' })
      }
    })
  })
}

interface HostEntry {
  ip: string
  domain: string
  comment?: string
}

export class HostsManager {
  private hostsPath: string

  constructor() {
    // Windows hosts 文件路径
    this.hostsPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  }

  /**
   * 获取 hosts 文件内容
   */
  async getHosts(): Promise<HostEntry[]> {
    try {
      if (!existsSync(this.hostsPath)) {
        return []
      }

      const content = readFileSync(this.hostsPath, 'utf-8')
      const entries: HostEntry[] = []

      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        
        // 跳过空行和注释
        if (!trimmed || trimmed.startsWith('#')) {
          continue
        }

        // 解析行
        const match = trimmed.match(/^(\S+)\s+(\S+)(?:\s+#\s*(.*))?$/)
        if (match) {
          entries.push({
            ip: match[1],
            domain: match[2],
            comment: match[3]
          })
        }
      }

      return entries
    } catch (error) {
      console.error('读取 hosts 文件失败:', error)
      return []
    }
  }

  /**
   * 添加 hosts 条目
   */
  async addHost(domain: string, ip: string = '127.0.0.1'): Promise<{ success: boolean; message: string }> {
    try {
      // 读取现有内容
      let content = ''
      if (existsSync(this.hostsPath)) {
        content = readFileSync(this.hostsPath, 'utf-8')
      }

      // 检查是否已存在
      const regex = new RegExp(`^\\s*\\S+\\s+${this.escapeRegex(domain)}\\s*$`, 'gm')
      if (regex.test(content)) {
        // 更新现有条目
        content = content.replace(regex, `${ip}\t${domain}`)
      } else {
        // 添加新条目
        const newEntry = `${ip}\t${domain}\t# Added by PHPer Dev Manager`
        content = content.trimEnd() + '\n' + newEntry + '\n'
      }

      // 写入文件（需要管理员权限）
      await this.writeHostsFile(content)

      return { success: true, message: `已添加 ${domain} -> ${ip}` }
    } catch (error: any) {
      return { success: false, message: `添加失败: ${error.message}` }
    }
  }

  /**
   * 删除 hosts 条目
   */
  async removeHost(domain: string): Promise<{ success: boolean; message: string }> {
    try {
      if (!existsSync(this.hostsPath)) {
        return { success: false, message: 'hosts 文件不存在' }
      }

      let content = readFileSync(this.hostsPath, 'utf-8')

      // 删除匹配的行
      const lines = content.split('\n')
      const newLines = lines.filter(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
          return true
        }
        const match = trimmed.match(/^\S+\s+(\S+)/)
        return !match || match[1] !== domain
      })

      content = newLines.join('\n')

      // 写入文件
      await this.writeHostsFile(content)

      return { success: true, message: `已删除 ${domain}` }
    } catch (error: any) {
      return { success: false, message: `删除失败: ${error.message}` }
    }
  }

  /**
   * 批量添加 hosts 条目
   */
  async addHosts(entries: HostEntry[]): Promise<{ success: boolean; message: string }> {
    try {
      let content = ''
      if (existsSync(this.hostsPath)) {
        content = readFileSync(this.hostsPath, 'utf-8')
      }

      for (const entry of entries) {
        const regex = new RegExp(`^\\s*\\S+\\s+${this.escapeRegex(entry.domain)}\\s*(?:#.*)?$`, 'gm')
        if (regex.test(content)) {
          // 更新现有条目
          content = content.replace(regex, `${entry.ip}\t${entry.domain}${entry.comment ? `\t# ${entry.comment}` : ''}`)
        } else {
          // 添加新条目
          const newEntry = `${entry.ip}\t${entry.domain}${entry.comment ? `\t# ${entry.comment}` : ''}`
          content = content.trimEnd() + '\n' + newEntry
        }
      }

      content = content.trimEnd() + '\n'

      await this.writeHostsFile(content)

      return { success: true, message: `已添加 ${entries.length} 个条目` }
    } catch (error: any) {
      return { success: false, message: `添加失败: ${error.message}` }
    }
  }

  /**
   * 刷新 DNS 缓存
   */
  async flushDns(): Promise<{ success: boolean; message: string }> {
    try {
      await execAsync('ipconfig /flushdns')
      return { success: true, message: 'DNS 缓存已刷新' }
    } catch (error: any) {
      return { success: false, message: `刷新失败: ${error.message}` }
    }
  }

  // ==================== 私有方法 ====================

  private async writeHostsFile(content: string): Promise<void> {
    // 直接写入（需要管理员权限运行应用）
    try {
      writeFileSync(this.hostsPath, content, 'utf-8')
    } catch (error: any) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        // 尝试使用 sudo-prompt 提权写入
        const tempPath = join(process.env.TEMP || 'C:\\Temp', 'hosts_phper.tmp')
        writeFileSync(tempPath, content, 'utf-8')
        
        // 使用 copy 命令复制临时文件到 hosts
        const command = `copy /Y "${tempPath}" "${this.hostsPath}"`
        
        try {
          await sudoExec(command, 'PHPer Dev Manager')
          // 清理临时文件
          try {
            unlinkSync(tempPath)
          } catch (e) {
            // 忽略清理错误
          }
        } catch (sudoError: any) {
          // 清理临时文件
          try {
            unlinkSync(tempPath)
          } catch (e) {
            // 忽略清理错误
          }
          throw new Error(`需要管理员权限修改 hosts 文件: ${sudoError.message}`)
        }
      } else {
        throw error
      }
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

