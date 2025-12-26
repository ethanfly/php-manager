import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// PHP-CGI 服务状态
interface PhpCgiStatus {
  version: string
  port: number
  running: boolean
}

// 服务状态
interface ServiceStatus {
  nginx: boolean
  mysql: boolean
  redis: boolean
  phpCgi: PhpCgiStatus[]
}

// PHP 版本信息
interface PhpVersion {
  version: string
  path: string
  isActive: boolean
}

// Node.js 版本信息
interface NodeVersion {
  version: string
  path: string
  isActive: boolean
}

// 站点信息
interface SiteConfig {
  name: string
  domain: string
  rootPath: string
  phpVersion: string
  isLaravel: boolean
  ssl: boolean
  enabled: boolean
}

export const useServiceStore = defineStore('service', () => {
  // 服务运行状态
  const serviceStatus = ref<ServiceStatus>({
    nginx: false,
    mysql: false,
    redis: false,
    phpCgi: []
  })

  // PHP 版本列表
  const phpVersions = ref<PhpVersion[]>([])
  
  // Node.js 版本列表
  const nodeVersions = ref<NodeVersion[]>([])
  
  // 站点列表
  const sites = ref<SiteConfig[]>([])
  
  // 基础路径
  const basePath = ref('')
  
  // 加载状态
  const loading = ref(false)
  
  // 最后更新时间
  const lastUpdated = ref<Date | null>(null)

  // 计算属性：所有 PHP-CGI 是否都在运行
  const allPhpCgiRunning = computed(() => {
    if (serviceStatus.value.phpCgi.length === 0) return false
    return serviceStatus.value.phpCgi.every(p => p.running)
  })

  // 计算属性：是否有任何 PHP-CGI 在运行
  const anyPhpCgiRunning = computed(() => {
    return serviceStatus.value.phpCgi.some(p => p.running)
  })

  // 计算属性：运行中的服务数量
  const runningServiceCount = computed(() => {
    let count = 0
    if (serviceStatus.value.nginx) count++
    if (serviceStatus.value.mysql) count++
    if (serviceStatus.value.redis) count++
    count += serviceStatus.value.phpCgi.filter(p => p.running).length
    return count
  })

  // 计算属性：当前活动的 PHP 版本
  const activePhpVersion = computed(() => {
    return phpVersions.value.find(v => v.isActive)
  })

  // 计算属性：当前活动的 Node.js 版本
  const activeNodeVersion = computed(() => {
    return nodeVersions.value.find(v => v.isActive)
  })

  // 刷新所有状态
  async function refreshAll() {
    loading.value = true
    try {
      await Promise.all([
        refreshServiceStatus(),
        refreshPhpVersions(),
        refreshNodeVersions(),
        refreshSites(),
        refreshBasePath()
      ])
      lastUpdated.value = new Date()
    } catch (error) {
      console.error('刷新状态失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 刷新服务状态
  async function refreshServiceStatus() {
    try {
      // 获取基础服务状态
      const allServices = await window.electronAPI?.service.getAll()
      if (allServices) {
        // 重置 MySQL 状态为 false，然后检测是否有任一版本在运行
        serviceStatus.value.mysql = false
        
        for (const svc of allServices) {
          if (svc.name === 'nginx') {
            serviceStatus.value.nginx = svc.running
          } else if (svc.name.startsWith('mysql-')) {
            // MySQL 服务名称格式为 mysql-{version}，只要有一个版本在运行就设为 true
            if (svc.running) {
              serviceStatus.value.mysql = true
            }
          } else if (svc.name === 'redis') {
            serviceStatus.value.redis = svc.running
          }
        }
      }

      // 获取 PHP-CGI 状态
      const phpCgiStatus = await window.electronAPI?.service.getPhpCgiStatus()
      if (phpCgiStatus) {
        serviceStatus.value.phpCgi = phpCgiStatus
      }
    } catch (error) {
      console.error('刷新服务状态失败:', error)
    }
  }

  // 刷新 PHP 版本列表
  async function refreshPhpVersions() {
    try {
      const versions = await window.electronAPI?.php.getVersions()
      if (versions) {
        phpVersions.value = versions
      }
    } catch (error) {
      console.error('刷新 PHP 版本失败:', error)
    }
  }

  // 刷新 Node.js 版本列表
  async function refreshNodeVersions() {
    try {
      const versions = await window.electronAPI?.node.getVersions()
      if (versions) {
        nodeVersions.value = versions
      }
    } catch (error) {
      console.error('刷新 Node.js 版本失败:', error)
    }
  }

  // 刷新站点列表
  async function refreshSites() {
    try {
      const siteList = await window.electronAPI?.nginx.getSites()
      if (siteList) {
        sites.value = siteList
      }
    } catch (error) {
      console.error('刷新站点列表失败:', error)
    }
  }

  // 刷新基础路径
  async function refreshBasePath() {
    try {
      const path = await window.electronAPI?.config.getBasePath()
      if (path) {
        basePath.value = path
      }
    } catch (error) {
      console.error('刷新基础路径失败:', error)
    }
  }

  // 更新单个服务状态
  function updateServiceStatus(service: 'nginx' | 'mysql' | 'redis', running: boolean) {
    serviceStatus.value[service] = running
  }

  // 更新 PHP-CGI 状态
  function updatePhpCgiStatus(version: string, running: boolean) {
    const index = serviceStatus.value.phpCgi.findIndex(p => p.version === version)
    if (index !== -1) {
      serviceStatus.value.phpCgi[index].running = running
    }
  }

  return {
    // 状态
    serviceStatus,
    phpVersions,
    nodeVersions,
    sites,
    basePath,
    loading,
    lastUpdated,
    // 计算属性
    allPhpCgiRunning,
    anyPhpCgiRunning,
    runningServiceCount,
    activePhpVersion,
    activeNodeVersion,
    // 方法
    refreshAll,
    refreshServiceStatus,
    refreshPhpVersions,
    refreshNodeVersions,
    refreshSites,
    refreshBasePath,
    updateServiceStatus,
    updatePhpCgiStatus
  }
})

