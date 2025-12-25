<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Coin /></el-icon></span>
        MySQL 管理
      </h1>
      <p class="page-description">安装、配置和管理 MySQL 数据库服务</p>
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
          <el-icon class="empty-icon"><Coin /></el-icon>
          <h3 class="empty-title">暂未安装 MySQL</h3>
          <p class="empty-description">点击上方按钮安装 MySQL 数据库</p>
        </div>
        <div v-else>
          <div 
            v-for="version in installedVersions" 
            :key="version.version"
            class="version-card"
            :class="{ running: version.isRunning }"
          >
            <div class="version-info">
              <div class="version-icon mysql-icon">
                <el-icon><Coin /></el-icon>
              </div>
              <div class="version-details">
                <div class="version-name">
                  MySQL {{ version.version }}
                  <span class="status-tag" :class="version.isRunning ? 'running' : 'stopped'">
                    <span class="status-dot"></span>
                    {{ version.isRunning ? '运行中' : '已停止' }}
                  </span>
                </div>
                <div class="version-path">{{ version.path }}</div>
              </div>
            </div>
            <div class="version-actions">
              <el-button 
                v-if="!version.isRunning" 
                type="success" 
                size="small" 
                @click="start(version.version)"
                :loading="actionLoading === version.version"
              >
                <el-icon><VideoPlay /></el-icon>
                启动
              </el-button>
              <el-button 
                v-else 
                type="warning" 
                size="small" 
                @click="stop(version.version)"
                :loading="actionLoading === version.version"
              >
                <el-icon><VideoPause /></el-icon>
                停止
              </el-button>
              <el-button 
                size="small" 
                @click="restart(version.version)"
                :loading="actionLoading === version.version"
                :disabled="!version.isRunning"
              >
                <el-icon><RefreshRight /></el-icon>
                重启
              </el-button>
              <el-button size="small" @click="showPasswordDialog(version.version)">
                <el-icon><Key /></el-icon>
                密码
              </el-button>
              <el-button size="small" @click="showConfig(version)">
                <el-icon><Document /></el-icon>
                配置
              </el-button>
              <el-button 
                type="danger" 
                size="small" 
                @click="uninstall(version.version)"
                :disabled="version.isRunning"
              >
                <el-icon><Delete /></el-icon>
                卸载
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装 MySQL"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          安装说明
        </template>
        MySQL 将从阿里云镜像站下载，安装后自动设置 root 密码为 123456。
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
            <span class="version-number">MySQL {{ version.version }}</span>
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

    <!-- 修改密码对话框 -->
    <el-dialog 
      v-model="passwordDialogVisible" 
      title="修改 root 密码"
      width="450px"
    >
      <el-form :model="passwordForm" label-width="100px">
        <el-form-item label="当前密码">
          <el-input 
            v-model="passwordForm.currentPassword" 
            type="password" 
            show-password
            placeholder="请输入当前密码（默认 123456）"
          />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input 
            v-model="passwordForm.newPassword" 
            type="password" 
            show-password
            placeholder="请输入新密码"
          />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input 
            v-model="passwordForm.confirmPassword" 
            type="password" 
            show-password
            placeholder="请再次输入密码"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button 
          type="primary" 
          @click="changePassword" 
          :loading="changingPassword"
        >
          确认修改
        </el-button>
      </template>
    </el-dialog>

    <!-- 配置编辑对话框 -->
    <el-dialog 
      v-model="showConfigDialog" 
      title="编辑 my.ini"
      width="900px"
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

interface MysqlVersion {
  version: string
  path: string
  isRunning: boolean
}

interface AvailableVersion {
  version: string
  downloadUrl: string
}

const loading = ref(false)
const installedVersions = ref<MysqlVersion[]>([])
const availableVersions = ref<AvailableVersion[]>([])
const showInstallDialog = ref(false)
const selectedVersion = ref('')
const installing = ref(false)
const actionLoading = ref('')
const downloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})

const passwordDialogVisible = ref(false)
const currentPasswordVersion = ref('')
const passwordForm = reactive({
  currentPassword: '123456',
  newPassword: '',
  confirmPassword: ''
})
const changingPassword = ref(false)

const showConfigDialog = ref(false)
const configContent = ref('')
const savingConfig = ref(false)
const currentVersion = ref('')

const loadVersions = async () => {
  try {
    installedVersions.value = await window.electronAPI?.mysql.getVersions() || []
  } catch (error: any) {
    console.error('加载版本失败:', error)
  }
}

const loadAvailableVersions = async () => {
  try {
    availableVersions.value = await window.electronAPI?.mysql.getAvailableVersions() || []
  } catch (error: any) {
    ElMessage.error('加载可用版本失败: ' + error.message)
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
    const result = await window.electronAPI?.mysql.install(selectedVersion.value)
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
    // 重置进度
    downloadProgress.progress = 0
    downloadProgress.downloaded = 0
    downloadProgress.total = 0
  }
}

const uninstall = async (version: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要卸载 MySQL ${version} 吗？数据库文件将被删除，此操作不可恢复。`,
      '确认卸载',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.mysql.uninstall(version)
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

const start = async (version: string) => {
  actionLoading.value = version
  try {
    const result = await window.electronAPI?.mysql.start(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = ''
  }
}

const stop = async (version: string) => {
  actionLoading.value = version
  try {
    const result = await window.electronAPI?.mysql.stop(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = ''
  }
}

const restart = async (version: string) => {
  actionLoading.value = version
  try {
    const result = await window.electronAPI?.mysql.restart(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    actionLoading.value = ''
  }
}

const showPasswordDialog = (version: string) => {
  currentPasswordVersion.value = version
  passwordForm.currentPassword = '123456'
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  passwordDialogVisible.value = true
}

const changePassword = async () => {
  if (!passwordForm.currentPassword) {
    ElMessage.error('请输入当前密码')
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.error('两次输入的密码不一致')
    return
  }
  
  changingPassword.value = true
  try {
    const result = await window.electronAPI?.mysql.changePassword(
      currentPasswordVersion.value, 
      passwordForm.newPassword,
      passwordForm.currentPassword
    )
    if (result?.success) {
      ElMessage.success(result.message)
      passwordDialogVisible.value = false
    } else {
      ElMessage.error(result?.message || '修改失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    changingPassword.value = false
  }
}

const showConfig = async (version: MysqlVersion) => {
  currentVersion.value = version.version
  try {
    configContent.value = await window.electronAPI?.mysql.getConfig(version.version) || ''
    showConfigDialog.value = true
  } catch (error: any) {
    ElMessage.error('加载配置失败: ' + error.message)
  }
}

const saveConfig = async () => {
  savingConfig.value = true
  try {
    const result = await window.electronAPI?.mysql.saveConfig(currentVersion.value, configContent.value)
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

// 格式化文件大小
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
  // 每 5 秒刷新状态
  setInterval(loadVersions, 5000)
  
  // 监听下载进度
  window.electronAPI?.onDownloadProgress((data: any) => {
    if (data.type === 'mysql') {
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

.mb-4 {
  margin-bottom: 16px;
}

.version-card {
  &.running {
    border-color: var(--success-color);
  }
}

.mysql-icon {
  background: linear-gradient(135deg, #00758f 0%, #00b4d8 100%) !important;
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

