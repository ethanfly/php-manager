<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon redis-gradient"><el-icon><Grid /></el-icon></span>
        Redis 管理
      </h1>
      <p class="page-description">安装、配置和管理 Redis 缓存服务</p>
    </div>

    <!-- 服务状态 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Grid /></el-icon>
          服务状态
        </span>
        <div class="card-actions">
          <el-button type="primary" @click="showInstallDialog = true" v-if="!currentVersion">
            <el-icon><Plus /></el-icon>
            安装 Redis
          </el-button>
        </div>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else-if="!currentVersion" class="empty-state">
          <el-icon class="empty-icon"><Grid /></el-icon>
          <h3 class="empty-title">暂未安装 Redis</h3>
          <p class="empty-description">点击上方按钮安装 Redis</p>
        </div>
        <div v-else class="service-panel">
          <div class="service-status">
            <div class="status-main">
              <div class="service-icon redis-gradient">
                <el-icon><Grid /></el-icon>
              </div>
              <div class="service-info">
                <h3 class="service-name">Redis {{ currentVersion }}</h3>
                <span class="status-tag" :class="status.running ? 'running' : 'stopped'">
                  <span class="status-dot"></span>
                  {{ status.running ? '运行中' : '已停止' }}
                  <span v-if="status.pid"> (PID: {{ status.pid }})</span>
                </span>
                <div class="status-extra" v-if="status.running && status.port">
                  <span class="extra-item">端口: {{ status.port }}</span>
                  <span class="extra-item" v-if="status.memory">内存: {{ status.memory }}</span>
                </div>
              </div>
            </div>
            <div class="service-controls">
              <el-button 
                v-if="!status.running" 
                type="success" 
                @click="start"
                :loading="actionLoading"
              >
                <el-icon><VideoPlay /></el-icon>
                启动
              </el-button>
              <el-button 
                v-else 
                type="warning" 
                @click="stop"
                :loading="actionLoading"
              >
                <el-icon><VideoPause /></el-icon>
                停止
              </el-button>
              <el-button @click="restart" :loading="actionLoading" :disabled="!status.running">
                <el-icon><RefreshRight /></el-icon>
                重启
              </el-button>
              <el-button @click="showConfig">
                <el-icon><Document /></el-icon>
                编辑配置
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 版本管理 -->
    <div class="card" v-if="currentVersion">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Tickets /></el-icon>
          版本管理
        </span>
      </div>
      <div class="card-content">
        <div class="version-switcher">
          <span class="current-version">当前版本: Redis {{ currentVersion }}</span>
          <el-button @click="showInstallDialog = true">
            <el-icon><Refresh /></el-icon>
            切换版本
          </el-button>
          <el-button type="danger" @click="uninstall" :disabled="status.running">
            <el-icon><Delete /></el-icon>
            卸载
          </el-button>
        </div>
      </div>
    </div>

    <!-- 安装对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装/切换 Redis 版本"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          Windows 版 Redis
        </template>
        将从 GitHub 下载 Windows 版 Redis，下载速度可能较慢。
      </el-alert>
      <div class="available-versions">
        <div 
          v-for="version in availableVersions" 
          :key="version.version"
          class="available-version-item"
          :class="{ selected: selectedVersion === version.version }"
          @click="selectedVersion = version.version"
        >
          <div class="version-select-info">
            <span class="version-number">Redis {{ version.version }}</span>
          </div>
          <el-icon v-if="selectedVersion === version.version" class="check-icon"><Check /></el-icon>
        </div>
      </div>
      <!-- 下载进度条 -->
      <div v-if="installing && downloadProgress.total > 0" class="download-progress">
        <div class="progress-info">
          <span>下载中...</span>
          <span>{{ formatSize(downloadProgress.downloaded) }} / {{ formatSize(downloadProgress.total) }}</span>
        </div>
        <el-progress :percentage="downloadProgress.progress" :stroke-width="10" />
      </div>
      <template #footer>
        <el-button @click="showInstallDialog = false" :disabled="installing">取消</el-button>
        <el-button 
          type="primary" 
          @click="install" 
          :loading="installing"
          :disabled="!selectedVersion"
        >
          {{ installing ? '安装中...' : '安装' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 配置编辑对话框 -->
    <el-dialog 
      v-model="showConfigDialog" 
      title="编辑 redis.windows.conf"
      width="1000px"
    >
      <textarea 
        v-model="configContent"
        class="code-editor"
        spellcheck="false"
      ></textarea>
      <template #footer>
        <el-button @click="showConfigDialog = false">取消</el-button>
        <el-button type="primary" @click="saveConfig" :loading="savingConfig">
          保存配置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useServiceStore } from '@/stores/serviceStore'

const store = useServiceStore()

interface RedisStatus {
  running: boolean
  pid?: number
  port?: number
  memory?: string
}

interface AvailableVersion {
  version: string
  downloadUrl: string
}

const loading = ref(false)
const currentVersion = ref('')
const status = ref<RedisStatus>({ running: false })
const availableVersions = ref<AvailableVersion[]>([])
const showInstallDialog = ref(false)
const selectedVersion = ref('')
const installing = ref(false)
const actionLoading = ref(false)
const downloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})

const showConfigDialog = ref(false)
const configContent = ref('')
const savingConfig = ref(false)

const loadData = async () => {
  try {
    const versions = await window.electronAPI?.redis.getVersions() || []
    if (versions.length > 0) {
      currentVersion.value = versions[0].version
    }
    status.value = await window.electronAPI?.redis.getStatus() || { running: false }
    // 同步更新全局状态
    store.refreshServiceStatus()
  } catch (error: any) {
    console.error('加载数据失败:', error)
  } finally {
  }
}

const loadAvailableVersions = async () => {
  try {
    availableVersions.value = await window.electronAPI?.redis.getAvailableVersions() || []
  } catch (error: any) {
    console.error('加载可用版本失败:', error)
  }
}

const install = async () => {
  if (!selectedVersion.value) return
  
  // 重置进度
  downloadProgress.progress = 0
  downloadProgress.downloaded = 0
  downloadProgress.total = 0
  
  installing.value = true
  try {
    if (status.value.running) {
      await window.electronAPI?.redis.stop()
    }
    
    const result = await window.electronAPI?.redis.install(selectedVersion.value)
    if (result?.success) {
      ElMessage.success(result.message)
      showInstallDialog.value = false
      selectedVersion.value = ''
      await loadData()
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    installing.value = false
    // 重置进度
    downloadProgress.progress = 0
    downloadProgress.downloaded = 0
    downloadProgress.total = 0
  }
}

const uninstall = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要卸载 Redis 吗？',
      '确认卸载',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.redis.uninstall(currentVersion.value)
    if (result?.success) {
      ElMessage.success(result.message)
      currentVersion.value = ''
      await loadData()
    } else {
      ElMessage.error(result?.message || '卸载失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

const start = async () => {
  actionLoading.value = true
  try {
    const result = await window.electronAPI?.redis.start()
    if (result?.success) {
      ElMessage.success(result.message)
      await loadData()
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = false
  }
}

const stop = async () => {
  actionLoading.value = true
  try {
    const result = await window.electronAPI?.redis.stop()
    if (result?.success) {
      ElMessage.success(result.message)
      await loadData()
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = false
  }
}

const restart = async () => {
  actionLoading.value = true
  try {
    const result = await window.electronAPI?.redis.restart()
    if (result?.success) {
      ElMessage.success(result.message)
      await loadData()
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = false
  }
}

const showConfig = async () => {
  try {
    configContent.value = await window.electronAPI?.redis.getConfig() || ''
    showConfigDialog.value = true
  } catch (error: any) {
    ElMessage.error('加载配置失败: ' + error.message)
  }
}

const saveConfig = async () => {
  savingConfig.value = true
  try {
    const result = await window.electronAPI?.redis.saveConfig(configContent.value)
    if (result?.success) {
      ElMessage.success(result.message)
      showConfigDialog.value = false
    } else {
      ElMessage.error(result?.message || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    savingConfig.value = false
  }
}

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

onMounted(() => {
  loadData()
  loadAvailableVersions()
  setInterval(loadData, 5000)
  
  window.electronAPI?.onDownloadProgress((data: any) => {
    if (data.type === 'redis') {
      downloadProgress.progress = data.progress
      downloadProgress.downloaded = data.downloaded
      downloadProgress.total = data.total
    }
  })
})

onUnmounted(() => {
  window.electronAPI?.removeDownloadProgressListener()
})
</script>

<style lang="scss" scoped>
.redis-gradient {
  background: linear-gradient(135deg, #dc382d 0%, #ff6b6b 100%) !important;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-secondary);
  
  .is-loading {
    font-size: 24px;
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.mb-4 {
  margin-bottom: 16px;
}

.service-panel {
  .service-status {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .status-main {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  
  .service-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 32px;
  }
  
  .service-info {
    .service-name {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .status-extra {
      margin-top: 8px;
      display: flex;
      gap: 16px;
      
      .extra-item {
        font-size: 13px;
        color: var(--text-secondary);
        padding: 4px 10px;
        background: var(--bg-input);
        border-radius: 6px;
      }
    }
  }
  
  .service-controls {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
}

.version-switcher {
  display: flex;
  align-items: center;
  gap: 16px;
  
  .current-version {
    font-weight: 500;
    color: var(--text-secondary);
  }
}

.available-versions {
  max-height: 400px;
  overflow-y: auto;
}

.available-version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--accent-light);
    background: var(--bg-hover);
  }
  
  &.selected {
    border-color: var(--accent-color);
    background: rgba(124, 58, 237, 0.05);
  }
  
  .version-select-info {
    .version-number {
      font-weight: 600;
      font-size: 16px;
    }
  }
  
  .check-icon {
    color: var(--accent-color);
    font-size: 20px;
  }
}

.code-editor {
  width: 100%;
  height: 500px;
}
</style>

