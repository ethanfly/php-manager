<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Share /></el-icon></span>
        Git 管理
      </h1>
      <p class="page-description">安装和管理 Git 版本控制工具</p>
    </div>

    <!-- 系统 Git 状态 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><InfoFilled /></el-icon>
          Git 状态
        </span>
        <el-button size="small" @click="refreshStatus" :loading="loading">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else class="git-status">
          <div class="status-info">
            <div class="status-icon" :class="{ installed: gitStatus.installed }">
              <el-icon v-if="gitStatus.installed"><Check /></el-icon>
              <el-icon v-else><Close /></el-icon>
            </div>
            <div class="status-details">
              <div class="status-title">
                {{ gitStatus.installed ? 'Git 已安装' : 'Git 未安装' }}
                <el-tag v-if="gitStatus.version" type="success" size="small" class="ml-2">
                  v{{ gitStatus.version }}
                </el-tag>
              </div>
              <div class="status-path" v-if="gitStatus.path">
                {{ gitStatus.path }}
              </div>
            </div>
          </div>
          <div class="status-actions">
            <el-button 
              v-if="!gitStatus.installed && !localInstalled"
              type="primary" 
              @click="showInstallDialog = true"
            >
              <el-icon><Download /></el-icon>
              安装 Git
            </el-button>
            <el-button 
              v-if="localInstalled"
              type="danger" 
              @click="uninstallGit"
              :loading="uninstalling"
            >
              <el-icon><Delete /></el-icon>
              卸载
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- Git 配置 -->
    <div class="card" v-if="gitStatus.installed">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Setting /></el-icon>
          Git 全局配置
        </span>
      </div>
      <div class="card-content">
        <el-form :model="gitConfig" label-width="100px" class="config-form">
          <el-form-item label="用户名">
            <el-input v-model="gitConfig.name" placeholder="请输入 Git 用户名" />
          </el-form-item>
          <el-form-item label="邮箱">
            <el-input v-model="gitConfig.email" placeholder="请输入 Git 邮箱" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveConfig" :loading="savingConfig">
              保存配置
            </el-button>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <!-- 本地安装的 Git 版本 -->
    <div class="card" v-if="installedVersions.length > 0">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Box /></el-icon>
          本地安装版本
        </span>
      </div>
      <div class="card-content">
        <div 
          v-for="version in installedVersions" 
          :key="version.version"
          class="version-card active"
        >
          <div class="version-info">
            <div class="version-icon">
              <el-icon><Share /></el-icon>
            </div>
            <div class="version-details">
              <div class="version-name">
                Git {{ version.version }}
                <el-tag type="success" size="small" class="ml-2">已安装</el-tag>
              </div>
              <div class="version-path">{{ version.path }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装 Git"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>安装说明</template>
        将下载 Git for Windows 便携版，无需管理员权限即可使用。
      </el-alert>
      <div v-if="loadingVersions" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>加载可用版本...</span>
      </div>
      <div v-else class="available-versions">
        <div 
          v-for="version in availableVersions" 
          :key="version.version"
          class="available-version-item"
          :class="{ selected: selectedVersion === version.version }"
          @click="selectedVersion = version.version"
        >
          <div class="version-select-info">
            <span class="version-number">Git {{ version.version }}</span>
            <span class="version-type">{{ version.type === 'portable' ? '便携版' : '安装版' }}</span>
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
          @click="installGit" 
          :loading="installing"
          :disabled="!selectedVersion"
        >
          {{ installing ? '安装中...' : '安装' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface GitVersion {
  version: string
  path: string
  isActive: boolean
}

interface AvailableVersion {
  version: string
  downloadUrl: string
  type: string
}

const loading = ref(false)
const loadingVersions = ref(false)
const installing = ref(false)
const uninstalling = ref(false)
const savingConfig = ref(false)
const showInstallDialog = ref(false)
const selectedVersion = ref('')

const gitStatus = ref<{
  installed: boolean
  version?: string
  path?: string
}>({ installed: false })

const localInstalled = ref(false)
const installedVersions = ref<GitVersion[]>([])
const availableVersions = ref<AvailableVersion[]>([])

const gitConfig = reactive({
  name: '',
  email: ''
})

const downloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})

const refreshStatus = async () => {
  loading.value = true
  try {
    // 检查系统 Git
    gitStatus.value = await window.electronAPI?.git?.checkSystem() || { installed: false }
    
    // 获取本地安装的版本
    installedVersions.value = await window.electronAPI?.git?.getVersions() || []
    localInstalled.value = installedVersions.value.length > 0
    
    // 如果有 Git，加载配置
    if (gitStatus.value.installed) {
      const config = await window.electronAPI?.git?.getConfig() || {}
      gitConfig.name = config.name || ''
      gitConfig.email = config.email || ''
    }
  } catch (error: any) {
    console.error('加载状态失败:', error)
  } finally {
    loading.value = false
  }
}

const loadAvailableVersions = async () => {
  loadingVersions.value = true
  try {
    availableVersions.value = await window.electronAPI?.git?.getAvailableVersions() || []
    if (availableVersions.value.length > 0) {
      selectedVersion.value = availableVersions.value[0].version
    }
  } catch (error: any) {
    ElMessage.error('加载可用版本失败')
  } finally {
    loadingVersions.value = false
  }
}

const installGit = async () => {
  if (!selectedVersion.value) return
  
  downloadProgress.progress = 0
  downloadProgress.downloaded = 0
  downloadProgress.total = 0
  
  installing.value = true
  try {
    const result = await window.electronAPI?.git?.install(selectedVersion.value)
    if (result?.success) {
      ElMessage.success(result.message)
      showInstallDialog.value = false
      await refreshStatus()
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    installing.value = false
    downloadProgress.progress = 0
    downloadProgress.downloaded = 0
    downloadProgress.total = 0
  }
}

const uninstallGit = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要卸载本地安装的 Git 吗？',
      '确认卸载',
      { type: 'warning' }
    )
    
    uninstalling.value = true
    const result = await window.electronAPI?.git?.uninstall()
    if (result?.success) {
      ElMessage.success(result.message)
      await refreshStatus()
    } else {
      ElMessage.error(result?.message || '卸载失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  } finally {
    uninstalling.value = false
  }
}

const saveConfig = async () => {
  savingConfig.value = true
  try {
    const result = await window.electronAPI?.git?.setConfig(gitConfig.name, gitConfig.email)
    if (result?.success) {
      ElMessage.success(result.message)
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
  refreshStatus()
  loadAvailableVersions()
  
  // 监听下载进度
  window.electronAPI?.onDownloadProgress((data: any) => {
    if (data.type === 'git') {
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

.ml-2 {
  margin-left: 8px;
}

.mb-4 {
  margin-bottom: 16px;
}

.git-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  
  .status-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .status-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--bg-card);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    color: var(--text-muted);
    
    &.installed {
      background: rgba(103, 194, 58, 0.1);
      color: var(--success-color);
    }
  }
  
  .status-details {
    .status-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
    }
    
    .status-path {
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'Fira Code', monospace;
    }
  }
  
  .status-actions {
    display: flex;
    gap: 8px;
  }
}

.config-form {
  max-width: 500px;
}

.version-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  margin-bottom: 12px;
  
  &.active {
    border-color: var(--success-color);
    background: rgba(103, 194, 58, 0.05);
  }
  
  .version-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .version-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, #f05033 0%, #ff6b6b 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 24px;
  }
  
  .version-details {
    .version-name {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
    }
    
    .version-path {
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'Fira Code', monospace;
    }
  }
}

.available-versions {
  max-height: 300px;
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
    display: flex;
    flex-direction: column;
    gap: 4px;
    
    .version-number {
      font-weight: 600;
      font-size: 16px;
    }
    
    .version-type {
      font-size: 12px;
      color: var(--text-muted);
    }
  }
  
  .check-icon {
    color: var(--accent-color);
    font-size: 20px;
  }
}

.download-progress {
  margin-top: 16px;
  
  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }
}
</style>

