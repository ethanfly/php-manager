<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Setting /></el-icon></span>
        设置
      </h1>
      <p class="page-description">配置应用程序和服务设置</p>
    </div>

    <!-- 应用设置 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Monitor /></el-icon>
          应用设置
        </span>
      </div>
      <div class="card-content">
        <div class="setting-item">
          <div class="setting-info">
            <h4 class="setting-title">开机自动启动</h4>
            <p class="setting-description">Windows 启动时自动运行 PHPer 开发环境管理器</p>
          </div>
          <div class="setting-action">
            <el-switch 
              v-model="appSettings.autoLaunch"
              @change="(val) => toggleAutoLaunch(val as boolean)"
            />
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-info">
            <h4 class="setting-title">启动时最小化到托盘</h4>
            <p class="setting-description">开机自启时不弹出主窗口，直接在系统托盘后台运行</p>
          </div>
          <div class="setting-action">
            <el-switch 
              v-model="appSettings.startMinimized"
              @change="(val) => toggleStartMinimized(val as boolean)"
              :disabled="!appSettings.autoLaunch"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 基础设置 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Folder /></el-icon>
          基础设置
        </span>
      </div>
      <div class="card-content">
        <div class="setting-item">
          <div class="setting-info">
            <h4 class="setting-title">安装目录</h4>
            <p class="setting-description">PHP、MySQL、Nginx、Redis 等服务的安装目录</p>
          </div>
          <div class="setting-action">
            <el-input v-model="basePath" style="width: 400px" disabled />
            <el-button @click="openBasePath">
              <el-icon><FolderOpened /></el-icon>
              打开
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 服务开机自启动 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Timer /></el-icon>
          服务开机自启动
        </span>
        <span class="card-subtitle">独立于应用的 Windows 服务自启</span>
      </div>
      <div class="card-content">
        <div class="setting-item" v-for="service in services" :key="service.name">
          <div class="setting-info">
            <h4 class="setting-title">{{ service.displayName }}</h4>
            <p class="setting-description">{{ service.description }}</p>
          </div>
          <div class="setting-action">
            <el-switch 
              v-model="service.autoStart"
              @change="(val) => toggleAutoStart(service.name, val as boolean)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 关于 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><InfoFilled /></el-icon>
          关于
        </span>
      </div>
      <div class="card-content">
        <div class="about-section">
          <div class="app-info">
            <div class="app-logo-large">
              <img src="/icon.svg" alt="logo" />
            </div>
            <div class="app-details">
              <h2 class="app-title">PHPer 开发环境管理器</h2>
              <p class="app-version">
                版本 {{ appVersion.version }}
                <span v-if="appVersion.buildDate" class="build-date">
                  ({{ appVersion.buildDate }})
                </span>
                <el-tag v-if="!appVersion.isPackaged" type="warning" size="small" style="margin-left: 8px">开发版</el-tag>
              </p>
              <p class="app-desc">
                一站式 PHP 开发环境管理工具，支持 PHP、MySQL、Nginx、Redis、Node.js 的安装和管理。
              </p>
            </div>
          </div>
          <div class="about-links">
            <el-button @click="openLink('https://windows.php.net/download/')">
              PHP for Windows
            </el-button>
            <el-button @click="openLink('https://nginx.org/')">
              Nginx 官网
            </el-button>
            <el-button @click="openLink('https://dev.mysql.com/')">
              MySQL 官网
            </el-button>
            <el-button @click="openLink('https://redis.io/')">
              Redis 官网
            </el-button>
            <el-button @click="openLink('https://nodejs.org/')">
              Node.js 官网
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Monitor } from '@element-plus/icons-vue'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'Settings'
})

interface ServiceAutoStart {
  name: string
  displayName: string
  description: string
  autoStart: boolean
}

interface AppSettings {
  autoLaunch: boolean
  startMinimized: boolean
}

const basePath = ref('')
const appSettings = reactive<AppSettings>({
  autoLaunch: false,
  startMinimized: false
})

const services = reactive<ServiceAutoStart[]>([
  { name: 'nginx', displayName: 'Nginx', description: '开机时自动启动 Nginx 服务（独立于应用）', autoStart: false },
  { name: 'mysql', displayName: 'MySQL', description: '开机时自动启动 MySQL 服务（独立于应用）', autoStart: false },
  { name: 'redis', displayName: 'Redis', description: '开机时自动启动 Redis 服务（独立于应用）', autoStart: false }
])

const appVersion = reactive({
  version: '1.0.0',
  buildTime: '',
  buildDate: '',
  isPackaged: false
})

const loadSettings = async () => {
  try {
    basePath.value = await window.electronAPI?.config.getBasePath() || ''
    
    // 加载应用设置
    appSettings.autoLaunch = await window.electronAPI?.app?.getAutoLaunch() || false
    appSettings.startMinimized = await window.electronAPI?.app?.getStartMinimized() || false
    
    // 加载版本信息
    const versionInfo = await window.electronAPI?.app?.getVersion()
    if (versionInfo) {
      appVersion.version = versionInfo.version
      appVersion.buildTime = versionInfo.buildTime
      appVersion.buildDate = versionInfo.buildDate
      appVersion.isPackaged = versionInfo.isPackaged
    }
    
    // 加载服务自启动设置
    for (const service of services) {
      service.autoStart = await window.electronAPI?.service.getAutoStart(service.name) || false
    }
  } catch (error: any) {
    console.error('加载设置失败:', error)
  }
}

const toggleAutoLaunch = async (enabled: boolean) => {
  try {
    const result = await window.electronAPI?.app?.setAutoLaunch(enabled)
    if (result?.success) {
      ElMessage.success(result.message)
      if (!enabled) {
        // 禁用开机自启时，同时禁用相关选项
        appSettings.startMinimized = false
      }
    } else {
      ElMessage.error(result?.message || '设置失败')
      appSettings.autoLaunch = !enabled
    }
  } catch (error: any) {
    ElMessage.error(error.message)
    appSettings.autoLaunch = !enabled
  }
}

const toggleStartMinimized = async (enabled: boolean) => {
  try {
    await window.electronAPI?.app?.setStartMinimized(enabled)
    ElMessage.success(enabled ? '已启用启动时最小化' : '已禁用启动时最小化')
  } catch (error: any) {
    ElMessage.error(error.message)
    appSettings.startMinimized = !enabled
  }
}

const toggleAutoStart = async (name: string, enabled: boolean) => {
  try {
    const result = await window.electronAPI?.service.setAutoStart(name, enabled)
    if (result?.success) {
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '设置失败')
      // 恢复状态
      const service = services.find(s => s.name === name)
      if (service) service.autoStart = !enabled
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const openBasePath = async () => {
  if (basePath.value) {
    await window.electronAPI?.openPath(basePath.value)
  }
}

const openLink = (url: string) => {
  window.electronAPI?.openExternal(url)
}

onMounted(() => {
  loadSettings()
})
</script>

<style lang="scss" scoped>
.card-subtitle {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 12px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
  border-bottom: 1px solid var(--border-light);
  
  &:last-child {
    border-bottom: none;
  }
  
  .setting-info {
    .setting-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    
    .setting-description {
      font-size: 13px;
      color: var(--text-muted);
    }
  }
  
  .setting-action {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

.about-section {
  .app-info {
    display: flex;
    align-items: center;
    gap: 24px;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-light);
  }
  
  .app-logo-large {
    width: 80px;
    height: 80px;
    
    img {
      width: 100%;
      height: 100%;
    }
  }
  
  .app-details {
    .app-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    
    .app-version {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      
      .build-date {
        font-size: 12px;
        color: var(--text-muted);
        opacity: 0.8;
      }
    }
    
    .app-desc {
      font-size: 14px;
      color: var(--text-secondary);
      max-width: 500px;
    }
  }
  
  .about-links {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
}
</style>

