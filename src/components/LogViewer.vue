<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="900px"
    class="log-viewer-dialog"
    :close-on-click-modal="false"
    @closed="onClosed"
  >
    <!-- 日志文件选择器 -->
    <div class="log-selector">
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="Nginx" name="nginx">
          <div class="log-list" v-if="logFiles.nginx.length > 0">
            <div
              v-for="file in logFiles.nginx"
              :key="file.path"
              class="log-item"
              :class="{ active: selectedLog?.path === file.path }"
              @click="selectLog(file)"
            >
              <div class="log-item-info">
                <el-icon :class="getLogIcon(file.type)"><Document /></el-icon>
                <span class="log-name">{{ file.name }}</span>
              </div>
              <div class="log-item-meta">
                <span class="log-size">{{ formatSize(file.size) }}</span>
                <span class="log-time">{{ formatTime(file.modifiedTime) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-log">暂无 Nginx 日志文件</div>
        </el-tab-pane>

        <el-tab-pane label="PHP" name="php">
          <div class="log-list" v-if="logFiles.php.length > 0">
            <div
              v-for="file in logFiles.php"
              :key="file.path"
              class="log-item"
              :class="{ active: selectedLog?.path === file.path }"
              @click="selectLog(file)"
            >
              <div class="log-item-info">
                <el-icon class="php-icon"><Document /></el-icon>
                <span class="log-name">{{ file.name }}</span>
              </div>
              <div class="log-item-meta">
                <span class="log-size">{{ formatSize(file.size) }}</span>
                <span class="log-time">{{ formatTime(file.modifiedTime) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-log">暂无 PHP 日志文件</div>
        </el-tab-pane>

        <el-tab-pane label="MySQL" name="mysql">
          <div class="log-list" v-if="logFiles.mysql.length > 0">
            <div
              v-for="file in logFiles.mysql"
              :key="file.path"
              class="log-item"
              :class="{ active: selectedLog?.path === file.path }"
              @click="selectLog(file)"
            >
              <div class="log-item-info">
                <el-icon class="mysql-icon"><Document /></el-icon>
                <span class="log-name">{{ file.name }}</span>
              </div>
              <div class="log-item-meta">
                <span class="log-size">{{ formatSize(file.size) }}</span>
                <span class="log-time">{{ formatTime(file.modifiedTime) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-log">暂无 MySQL 日志文件</div>
        </el-tab-pane>

        <el-tab-pane label="站点" name="sites">
          <div class="log-list" v-if="logFiles.sites.length > 0">
            <div
              v-for="file in logFiles.sites"
              :key="file.path"
              class="log-item"
              :class="{ active: selectedLog?.path === file.path }"
              @click="selectLog(file)"
            >
              <div class="log-item-info">
                <el-icon :class="file.type === 'site-error' ? 'error-icon' : 'access-icon'">
                  <Document />
                </el-icon>
                <span class="log-name">{{ file.name }}</span>
              </div>
              <div class="log-item-meta">
                <span class="log-size">{{ formatSize(file.size) }}</span>
                <span class="log-time">{{ formatTime(file.modifiedTime) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-log">暂无站点日志文件</div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 日志内容区域 -->
    <div class="log-content-area" v-if="selectedLog">
      <div class="log-toolbar">
        <div class="toolbar-left">
          <span class="selected-log-name">{{ selectedLog.name }}</span>
          <el-tag size="small" type="info">{{ formatSize(logContent.fileSize) }}</el-tag>
          <el-tag size="small" type="info">{{ logContent.totalLines }} 行</el-tag>
        </div>
        <div class="toolbar-right">
          <el-button size="small" @click="refreshLog" :loading="loading">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
          <el-button size="small" @click="openInExplorer">
            <el-icon><FolderOpened /></el-icon>
            打开目录
          </el-button>
          <el-button size="small" type="danger" @click="clearLog">
            <el-icon><Delete /></el-icon>
            清空
          </el-button>
        </div>
      </div>
      <div class="log-content-wrapper">
        <pre class="log-content" ref="logContentRef">{{ logContent.content || '（日志为空）' }}</pre>
      </div>
    </div>
    <div class="log-content-area empty" v-else>
      <el-icon class="empty-icon"><Document /></el-icon>
      <p>请选择左侧的日志文件查看</p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Refresh, FolderOpened, Delete } from '@element-plus/icons-vue'

interface LogFile {
  name: string
  path: string
  size: number
  modifiedTime: string | Date
  type: string
}

interface LogContent {
  content: string
  totalLines: number
  fileSize: number
}

const props = defineProps<{
  modelValue: boolean
  initialTab?: 'nginx' | 'php' | 'mysql' | 'sites'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const visible = ref(false)
const activeTab = ref<'nginx' | 'php' | 'mysql' | 'sites'>('nginx')
const loading = ref(false)
const logContentRef = ref<HTMLElement | null>(null)

const logFiles = reactive<{
  nginx: LogFile[]
  php: LogFile[]
  mysql: LogFile[]
  sites: LogFile[]
}>({
  nginx: [],
  php: [],
  mysql: [],
  sites: []
})

const selectedLog = ref<LogFile | null>(null)
const logContent = reactive<LogContent>({
  content: '',
  totalLines: 0,
  fileSize: 0
})

const dialogTitle = ref('日志查看器')

// 监听外部 modelValue 变化
watch(() => props.modelValue, async (newVal) => {
  visible.value = newVal
  if (newVal) {
    if (props.initialTab) {
      activeTab.value = props.initialTab
    }
    await loadLogFiles()
  }
})

// 同步内部状态到外部
watch(visible, (newVal) => {
  emit('update:modelValue', newVal)
})

// 加载日志文件列表
const loadLogFiles = async () => {
  loading.value = true
  try {
    const files = await window.electronAPI?.log.getFiles()
    if (files) {
      logFiles.nginx = files.nginx || []
      logFiles.php = files.php || []
      logFiles.mysql = files.mysql || []
      logFiles.sites = files.sites || []
    }
  } catch (error: any) {
    ElMessage.error('加载日志列表失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 选择日志文件
const selectLog = async (file: LogFile) => {
  selectedLog.value = file
  await loadLogContent(file.path)
}

// 加载日志内容
const loadLogContent = async (logPath: string) => {
  loading.value = true
  try {
    const result = await window.electronAPI?.log.read(logPath, 1000)
    if (result) {
      logContent.content = result.content
      logContent.totalLines = result.totalLines
      logContent.fileSize = result.fileSize
      
      // 滚动到底部
      await nextTick()
      if (logContentRef.value) {
        logContentRef.value.scrollTop = logContentRef.value.scrollHeight
      }
    }
  } catch (error: any) {
    ElMessage.error('读取日志失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 刷新日志
const refreshLog = async () => {
  if (selectedLog.value) {
    await loadLogContent(selectedLog.value.path)
  }
  await loadLogFiles()
}

// 清空日志
const clearLog = async () => {
  if (!selectedLog.value) return
  
  try {
    await ElMessageBox.confirm(
      `确定要清空日志 "${selectedLog.value.name}" 吗？此操作不可恢复。`,
      '确认清空',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.log.clear(selectedLog.value.path)
    if (result?.success) {
      ElMessage.success(result.message)
      await refreshLog()
    } else {
      ElMessage.error(result?.message || '清空失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败: ' + error.message)
    }
  }
}

// 在文件管理器中打开
const openInExplorer = async () => {
  if (!selectedLog.value) return
  
  // 获取文件所在目录
  const path = selectedLog.value.path
  const dir = path.substring(0, path.lastIndexOf('\\'))
  await window.electronAPI?.openPath(dir)
}

// Tab 切换
const onTabChange = () => {
  selectedLog.value = null
  logContent.content = ''
  logContent.totalLines = 0
  logContent.fileSize = 0
}

// 对话框关闭
const onClosed = () => {
  selectedLog.value = null
  logContent.content = ''
}

// 获取日志图标样式
const getLogIcon = (type: string) => {
  switch (type) {
    case 'nginx-error':
    case 'mysql-error':
    case 'site-error':
      return 'error-icon'
    case 'nginx-access':
    case 'site-access':
      return 'access-icon'
    default:
      return ''
  }
}

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 格式化时间
const formatTime = (time: string | Date): string => {
  const date = typeof time === 'string' ? new Date(time) : time
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前'
  
  return date.toLocaleDateString()
}
</script>

<style lang="scss" scoped>
.log-viewer-dialog {
  :deep(.el-dialog__body) {
    padding: 0;
    display: flex;
    flex-direction: column;
    height: 600px;
  }
}

.log-selector {
  border-bottom: 1px solid var(--border-color);
  padding: 16px 20px 0;
  
  :deep(.el-tabs__nav-wrap) {
    &::after {
      display: none;
    }
  }
  
  :deep(.el-tabs__item) {
    font-size: 14px;
  }
}

.log-list {
  max-height: 150px;
  overflow-y: auto;
  padding: 12px 0;
}

.log-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: var(--bg-hover);
  }
  
  &.active {
    background: rgba(124, 58, 237, 0.1);
    border-left: 3px solid var(--accent-color);
    padding-left: 13px;
  }
  
  .log-item-info {
    display: flex;
    align-items: center;
    gap: 10px;
    
    .el-icon {
      font-size: 18px;
      color: var(--text-muted);
      
      &.error-icon {
        color: var(--error-color);
      }
      
      &.access-icon {
        color: var(--success-color);
      }
      
      &.php-icon {
        color: #777BB4;
      }
      
      &.mysql-icon {
        color: #00758F;
      }
    }
    
    .log-name {
      font-size: 14px;
      color: var(--text-primary);
    }
  }
  
  .log-item-meta {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--text-muted);
  }
}

.empty-log {
  padding: 30px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

.log-content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  
  &.empty {
    justify-content: center;
    align-items: center;
    color: var(--text-muted);
    
    .empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }
  }
}

.log-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: var(--bg-input);
  border-bottom: 1px solid var(--border-color);
  
  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    
    .selected-log-name {
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary);
    }
  }
  
  .toolbar-right {
    display: flex;
    gap: 8px;
  }
}

.log-content-wrapper {
  flex: 1;
  overflow: auto;
  background: #0d1117;
  min-height: 0;
}

.log-content {
  margin: 0;
  padding: 16px 20px;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
  min-height: 100%;
}
</style>

