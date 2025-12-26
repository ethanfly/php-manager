<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Platform /></el-icon></span>
        Python 管理
      </h1>
      <p class="page-description">安装、切换和管理 Python 版本</p>
    </div>

    <!-- 已安装版本 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Box /></el-icon>
          已安装版本
        </span>
        <el-button type="primary" @click="showInstallDialog = true">
          <el-icon><Plus /></el-icon>
          安装新版本
        </el-button>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else-if="installedVersions.length === 0" class="empty-state">
          <el-icon class="empty-icon"><Platform /></el-icon>
          <h3 class="empty-title">暂未安装 Python</h3>
          <p class="empty-description">点击上方按钮安装第一个 Python 版本</p>
        </div>
        <div v-else>
          <div 
            v-for="version in installedVersions" 
            :key="version.version"
            class="version-card"
            :class="{ active: version.isActive }"
          >
            <div class="version-info">
              <div class="version-icon">
                <el-icon><Platform /></el-icon>
              </div>
              <div class="version-details">
                <div class="version-name">
                  Python {{ version.version }}
                  <el-tag v-if="version.isActive" type="success" size="small" class="ml-2">当前使用</el-tag>
                </div>
                <div class="version-path">{{ version.path }}</div>
                <div class="pip-info" v-if="pipInfo[version.version]">
                  <el-tag type="info" size="small">
                    pip {{ pipInfo[version.version] }}
                  </el-tag>
                </div>
              </div>
            </div>
            <div class="version-actions">
              <el-button 
                v-if="!version.isActive" 
                type="primary" 
                size="small" 
                @click="setActive(version.version)"
                :loading="settingActive === version.version"
              >
                设为默认
              </el-button>
              <el-button 
                type="danger" 
                size="small" 
                @click="uninstall(version.version)"
                :disabled="version.isActive"
              >
                <el-icon><Delete /></el-icon>
                卸载
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- pip 包管理 -->
    <div class="card" v-if="installedVersions.length > 0">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Box /></el-icon>
          pip 包管理
        </span>
      </div>
      <div class="card-content">
        <el-form inline class="pip-form">
          <el-form-item label="Python 版本">
            <el-select v-model="selectedPythonVersion" placeholder="选择版本">
              <el-option 
                v-for="v in installedVersions" 
                :key="v.version" 
                :label="`Python ${v.version}`" 
                :value="v.version" 
              />
            </el-select>
          </el-form-item>
          <el-form-item label="包名">
            <el-input v-model="packageName" placeholder="输入包名，如 requests" />
          </el-form-item>
          <el-form-item>
            <el-button 
              type="primary" 
              @click="installPackage" 
              :loading="installingPackage"
              :disabled="!selectedPythonVersion || !packageName"
            >
              安装包
            </el-button>
          </el-form-item>
        </el-form>
        <div class="pip-hint">
          常用包：requests, flask, django, numpy, pandas, pillow
        </div>
      </div>
    </div>

    <!-- 安装对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装 Python 版本"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          <el-icon><InfoFilled /></el-icon>
          下载源说明
        </template>
        Python 将从官方网站 <a href="https://www.python.org/downloads/windows/" target="_blank">python.org</a> 下载嵌入式版本（免安装），并自动配置 pip。
      </el-alert>
      <div v-if="loadingAvailableVersions" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在获取可用版本列表...</span>
      </div>
      <div v-else-if="availableVersions.length === 0" class="empty-hint">
        <span>暂无可用版本</span>
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
            <span class="version-number">Python {{ version.version }}</span>
            <span class="version-type">{{ version.type === 'embed' ? '嵌入式版本' : '安装版' }}</span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { InfoFilled } from '@element-plus/icons-vue'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'PythonManager'
})

interface PythonVersion {
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
const installedVersions = ref<PythonVersion[]>([])
const availableVersions = ref<AvailableVersion[]>([])
const showInstallDialog = ref(false)
const selectedVersion = ref('')
const installing = ref(false)
const settingActive = ref('')
const pipInfo = ref<Record<string, string>>({})

// pip 包管理
const selectedPythonVersion = ref('')
const packageName = ref('')
const installingPackage = ref(false)

const downloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})

const loadVersions = async () => {
  loading.value = true
  try {
    installedVersions.value = await window.electronAPI?.python?.getVersions() || []
    
    // 如果有安装的版本，加载 pip 信息
    for (const v of installedVersions.value) {
      const info = await window.electronAPI?.python?.getPipInfo(v.version)
      if (info?.installed) {
        pipInfo.value[v.version] = info.version || 'installed'
      }
    }
    
    // 默认选择第一个版本用于 pip
    if (installedVersions.value.length > 0 && !selectedPythonVersion.value) {
      selectedPythonVersion.value = installedVersions.value[0].version
    }
  } catch (error: any) {
    console.error('加载版本失败:', error)
  } finally {
    loading.value = false
  }
}

const loadingAvailableVersions = ref(false)

const loadAvailableVersions = async () => {
  loadingAvailableVersions.value = true
  try {
    availableVersions.value = await window.electronAPI?.python?.getAvailableVersions() || []
    if (availableVersions.value.length > 0) {
      selectedVersion.value = availableVersions.value[0].version
    }
  } catch (error: any) {
    ElMessage.error('加载可用版本失败: ' + error.message)
  } finally {
    loadingAvailableVersions.value = false
  }
}

const install = async () => {
  if (!selectedVersion.value) return
  
  downloadProgress.progress = 0
  downloadProgress.downloaded = 0
  downloadProgress.total = 0
  
  installing.value = true
  try {
    const result = await window.electronAPI?.python?.install(selectedVersion.value)
    if (result?.success) {
      ElMessage.success(result.message)
      showInstallDialog.value = false
      selectedVersion.value = ''
      await loadVersions()
      await loadAvailableVersions()
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

const uninstall = async (version: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要卸载 Python ${version} 吗？此操作不可恢复。`,
      '确认卸载',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.python?.uninstall(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
      await loadAvailableVersions()
    } else {
      ElMessage.error(result?.message || '卸载失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

const setActive = async (version: string) => {
  settingActive.value = version
  try {
    const result = await window.electronAPI?.python?.setActive(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    settingActive.value = ''
  }
}

const installPackage = async () => {
  if (!selectedPythonVersion.value || !packageName.value) return
  
  installingPackage.value = true
  try {
    const result = await window.electronAPI?.python?.installPackage(
      selectedPythonVersion.value,
      packageName.value
    )
    if (result?.success) {
      ElMessage.success(result.message)
      packageName.value = ''
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    installingPackage.value = false
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
  loadVersions()
  loadAvailableVersions()
  
  // 监听下载进度
  window.electronAPI?.onDownloadProgress((data: any) => {
    if (data.type === 'python') {
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

.version-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  margin-bottom: 12px;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--accent-light);
    box-shadow: var(--shadow-sm);
  }
  
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
    background: linear-gradient(135deg, #3776ab 0%, #ffd43b 100%);
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
      margin-bottom: 4px;
    }
    
    .pip-info {
      margin-top: 4px;
    }
  }
  
  .version-actions {
    display: flex;
    gap: 8px;
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

.pip-form {
  .el-form-item {
    margin-bottom: 16px;
  }
  
  .el-select {
    width: 160px;
  }
}

.pip-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
}

.empty-hint {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.mb-4 a {
  color: var(--accent-color);
  text-decoration: none;
  
  &:hover {
    text-decoration: underline;
  }
}
</style>

