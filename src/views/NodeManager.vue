<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Promotion /></el-icon></span>
        Node.js 管理
      </h1>
      <p class="page-description">管理本地 Node.js 版本，支持多版本切换</p>
    </div>

    <!-- 下载进度 -->
    <div v-if="downloadProgress.percent > 0 && downloadProgress.percent < 100" class="download-progress">
      <div class="progress-info">
        <span>正在下载 Node.js...</span>
        <span>{{ formatSize(downloadProgress.downloaded) }} / {{ formatSize(downloadProgress.total) }}</span>
      </div>
      <el-progress :percentage="downloadProgress.percent" :stroke-width="10" />
    </div>

    <!-- 已安装版本 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">已安装版本</span>
        <el-button type="primary" @click="showInstallDialog = true">
          <el-icon><Plus /></el-icon>
          安装新版本
        </el-button>
      </div>
      <div class="card-content">
        <div v-if="versions.length > 0" class="version-grid">
          <div 
            v-for="version in versions" 
            :key="version.version"
            class="version-card"
            :class="{ active: version.isActive }"
          >
            <div class="version-main">
              <div class="version-icon">
                <el-icon :size="32"><Promotion /></el-icon>
              </div>
              <div class="version-content">
                <div class="version-title">
                  <span class="version-number">Node.js {{ version.version }}</span>
                  <el-tag v-if="version.isActive" type="success" size="small" effect="dark">当前版本</el-tag>
                </div>
                <div class="version-meta">
                  <span v-if="version.npmVersion" class="npm-version">
                    <el-icon><Box /></el-icon>
                    npm {{ version.npmVersion }}
                  </span>
                </div>
              </div>
            </div>
            <div class="version-actions">
              <el-button 
                v-if="!version.isActive"
                type="primary" 
                size="small" 
                @click="setActiveVersion(version.version)"
                :loading="settingActive === version.version"
              >
                设为默认
              </el-button>
              <el-button 
                type="danger" 
                size="small" 
                plain
                @click="uninstallVersion(version.version)"
                :loading="uninstalling === version.version"
              >
                卸载
              </el-button>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂未安装 Node.js" />
      </div>
    </div>

    <!-- 安装新版本对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装 Node.js"
      width="700px"
    >
      <div class="available-versions">
        <el-table :data="availableVersions" style="width: 100%" max-height="400">
          <el-table-column prop="version" label="版本" width="120" />
          <el-table-column prop="date" label="发布日期" width="120" />
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.lts" type="success" size="small">LTS {{ row.lts }}</el-tag>
              <el-tag v-else type="warning" size="small">Current</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="安全更新" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.security" type="danger" size="small">安全</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button
                v-if="!isInstalled(row.version)"
                type="primary"
                size="small"
                @click="installVersion(row)"
                :loading="installing === row.version"
              >
                安装
              </el-button>
              <el-tag v-else type="info" size="small">已安装</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="showInstallDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Promotion, Box } from '@element-plus/icons-vue'

interface NodeVersion {
  version: string
  path: string
  isActive: boolean
  npmVersion?: string
}

interface AvailableNodeVersion {
  version: string
  date: string
  lts: string | false
  security: boolean
  downloadUrl: string
}

const versions = ref<NodeVersion[]>([])
const availableVersions = ref<AvailableNodeVersion[]>([])
const showInstallDialog = ref(false)
const installing = ref('')
const uninstalling = ref('')
const settingActive = ref('')

const downloadProgress = reactive({
  percent: 0,
  downloaded: 0,
  total: 0
})

const loadVersions = async () => {
  try {
    versions.value = await window.electronAPI?.node.getVersions() || []
  } catch (error: any) {
    console.error('加载版本失败:', error)
  }
}

const loadAvailableVersions = async () => {
  try {
    availableVersions.value = await window.electronAPI?.node.getAvailableVersions() || []
  } catch (error: any) {
    console.error('加载可用版本失败:', error)
  }
}

const isInstalled = (version: string) => {
  return versions.value.some(v => v.version === version)
}

const installVersion = async (row: AvailableNodeVersion) => {
  installing.value = row.version
  downloadProgress.percent = 0
  downloadProgress.downloaded = 0
  downloadProgress.total = 0
  
  try {
    const result = await window.electronAPI?.node.install(row.version, row.downloadUrl)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    installing.value = ''
    downloadProgress.percent = 0
  }
}

const uninstallVersion = async (version: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要卸载 Node.js ${version} 吗？`,
      '确认卸载',
      { type: 'warning' }
    )
    
    uninstalling.value = version
    const result = await window.electronAPI?.node.uninstall(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '卸载失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  } finally {
    uninstalling.value = ''
  }
}

const setActiveVersion = async (version: string) => {
  settingActive.value = version
  try {
    const result = await window.electronAPI?.node.setActive(version)
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

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 监听下载进度
const onDownloadProgress = (_event: any, data: any) => {
  if (data.type === 'nodejs') {
    downloadProgress.percent = data.progress
    downloadProgress.downloaded = data.downloaded
    downloadProgress.total = data.total
  }
}

onMounted(() => {
  loadVersions()
  loadAvailableVersions()
  window.electronAPI?.onDownloadProgress(onDownloadProgress)
})

onUnmounted(() => {
  window.electronAPI?.removeDownloadProgressListener(onDownloadProgress)
})
</script>

<style lang="scss" scoped>
.version-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.version-card {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s;
  display: flex;
  flex-direction: column;
  gap: 20px;
  
  &:hover {
    border-color: var(--accent-color);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    transform: translateY(-2px);
  }
  
  &.active {
    border-color: var(--success-color);
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
    
    .version-icon {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }
  }
  
  .version-main {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  
  .version-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: linear-gradient(135deg, #68a063 0%, #3c873a 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }
  
  .version-content {
    flex: 1;
    min-width: 0;
  }
  
  .version-title {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  
  .version-number {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.5px;
  }
  
  .version-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  
  .npm-version {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    background: var(--bg-card);
    padding: 4px 10px;
    border-radius: 6px;
    
    .el-icon {
      color: #cb3837;
    }
  }
  
  .version-actions {
    display: flex;
    gap: 10px;
    padding-top: 4px;
    border-top: 1px solid var(--border-color);
    
    .el-button {
      flex: 1;
    }
  }
}

.available-versions {
  .el-table {
    --el-table-bg-color: transparent;
    --el-table-tr-bg-color: transparent;
    --el-table-header-bg-color: var(--bg-input);
  }
}

.download-progress {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 20px;
  
  .progress-info {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 14px;
    color: var(--text-secondary);
  }
}
</style>

