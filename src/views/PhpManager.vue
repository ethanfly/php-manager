<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Files /></el-icon></span>
        PHP 版本管理
      </h1>
      <p class="page-description">安装、卸载和管理 PHP 版本，配置扩展</p>
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
          <el-icon class="empty-icon"><Files /></el-icon>
          <h3 class="empty-title">暂未安装 PHP</h3>
          <p class="empty-description">点击上方按钮安装第一个 PHP 版本</p>
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
                <el-icon><Files /></el-icon>
              </div>
              <div class="version-details">
                <div class="version-name">
                  PHP {{ version.version }}
                  <el-tag v-if="version.isActive" type="success" size="small" class="ml-2">当前使用</el-tag>
                  <el-tag 
                    v-if="isCgiRunning(version.version)" 
                    type="success" 
                    size="small" 
                    class="ml-2"
                  >
                    CGI:{{ getCgiPort(version.version) }}
                  </el-tag>
                </div>
                <div class="version-path">{{ version.path }}</div>
              </div>
            </div>
            <div class="version-actions">
              <!-- CGI 控制按钮 -->
              <el-tooltip 
                :content="isCgiRunning(version.version) 
                  ? `停止 CGI (端口 ${getCgiPort(version.version)})` 
                  : `启动 CGI (端口 ${getCgiPort(version.version)})`"
                placement="top"
              >
                <el-button 
                  v-if="isCgiRunning(version.version)"
                  type="danger" 
                  size="small" 
                  @click="stopCgi(version.version)"
                  :loading="cgiLoading[version.version]"
                >
                  <el-icon><VideoPause /></el-icon>
                  CGI
                </el-button>
                <el-button 
                  v-else
                  type="success" 
                  size="small" 
                  @click="startCgi(version.version)"
                  :loading="cgiLoading[version.version]"
                >
                  <el-icon><VideoPlay /></el-icon>
                  CGI
                </el-button>
              </el-tooltip>
              <el-button 
                v-if="!version.isActive" 
                type="primary" 
                size="small" 
                @click="setActive(version.version)"
              >
                设为默认
              </el-button>
              <el-button size="small" @click="showExtensions(version)">
                <el-icon><Setting /></el-icon>
                扩展
              </el-button>
              <el-button size="small" @click="showConfig(version)">
                <el-icon><EditPen /></el-icon>
                配置
              </el-button>
              <el-button size="small" @click="showLogViewerDialog">
                <el-icon><Document /></el-icon>
                日志
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

    <!-- Composer 管理 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Box /></el-icon>
          Composer 管理
        </span>
      </div>
      <div class="card-content">
        <div class="composer-status">
          <div class="status-info">
            <div class="status-icon" :class="{ installed: composerStatus.installed }">
              <el-icon v-if="composerStatus.installed"><Check /></el-icon>
              <el-icon v-else><Close /></el-icon>
            </div>
            <div class="status-details">
              <div class="status-title">
                {{ composerStatus.installed ? 'Composer 已安装' : 'Composer 未安装' }}
                <el-tag v-if="composerStatus.version" type="success" size="small" class="ml-2">
                  v{{ composerStatus.version }}
                </el-tag>
                <el-tag v-else-if="composerStatus.installed" type="warning" size="small" class="ml-2">
                  版本未知（请设置默认 PHP）
                </el-tag>
              </div>
              <div class="status-path" v-if="composerStatus.path">
                {{ composerStatus.path }}
              </div>
            </div>
          </div>
          <div class="status-actions">
            <el-button 
              v-if="!composerStatus.installed"
              type="primary" 
              @click="installComposer"
              :loading="installingComposer"
            >
              <el-icon><Download /></el-icon>
              安装 Composer
            </el-button>
            <template v-else>
              <el-button @click="showMirrorDialog = true">
                <el-icon><Setting /></el-icon>
                设置镜像
              </el-button>
              <el-button type="danger" @click="uninstallComposer" :loading="uninstallingComposer">
                <el-icon><Delete /></el-icon>
                卸载
              </el-button>
            </template>
          </div>
        </div>
        
        <!-- 当前镜像显示 -->
        <div v-if="composerStatus.installed" class="mirror-info">
          <span class="mirror-label">当前镜像源：</span>
          <span class="mirror-value">{{ getMirrorDisplayName(composerStatus.mirror) }}</span>
        </div>
      </div>
    </div>

    <!-- Composer 镜像设置对话框 -->
    <el-dialog 
      v-model="showMirrorDialog" 
      title="设置 Composer 镜像"
      width="500px"
    >
      <el-form label-width="80px">
        <el-form-item label="镜像源">
          <el-select v-model="selectedMirror" placeholder="选择镜像源" style="width: 100%">
            <el-option label="官方源（默认）" value="" />
            <el-option label="阿里云镜像" value="https://mirrors.aliyun.com/composer/" />
            <el-option label="腾讯云镜像" value="https://mirrors.cloud.tencent.com/composer/" />
            <el-option label="华为云镜像" value="https://mirrors.huaweicloud.com/repository/php/" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showMirrorDialog = false">取消</el-button>
        <el-button type="primary" @click="setMirror" :loading="settingMirror">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 安装对话框 -->
    <el-dialog 
      v-model="showInstallDialog" 
      title="安装 PHP 版本"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          <el-icon><InfoFilled /></el-icon>
          下载源说明
        </template>
        PHP 将从官方网站 <a href="https://windows.php.net" target="_blank">windows.php.net</a> 下载，国内网络可能较慢，请耐心等待。
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
            <span class="version-number">PHP {{ version.version }}</span>
            <span class="version-type">{{ version.type.toUpperCase() }} - {{ version.arch }}</span>
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

    <!-- 扩展管理对话框 -->
    <el-dialog 
      v-model="showExtensionsDialog" 
      title="PHP 扩展管理"
      width="800px"
    >
      <!-- 搜索框 -->
      <div class="extension-search-bar">
        <el-input
          v-model="extensionSearchKeyword"
          placeholder="搜索扩展名称（如 redis, xdebug）..."
          clearable
          class="extension-search"
          @keyup.enter="searchExtensions"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button 
          type="primary" 
          @click="searchExtensions" 
          :loading="loadingAvailableExtensions"
          :disabled="extensionTab !== 'available'"
        >
          搜索
        </el-button>
      </div>
      <el-alert type="info" :closable="false" class="mb-2" v-if="extensionTab === 'available'">
        扩展列表来源于 <a href="https://pecl.php.net/" target="_blank">pecl.php.net</a>，
        Windows 预编译版本由 <a href="https://windows.php.net/downloads/pecl/" target="_blank">windows.php.net</a> 提供。
        输入关键词搜索更多扩展。
      </el-alert>
      
      <!-- 手动安装提示和打开目录按钮 -->
      <div class="manual-install-hint mb-2">
        <el-button type="info" size="small" @click="openExtensionDir" :icon="FolderOpened">
          打开扩展目录
        </el-button>
        <span class="hint-text">手动安装：将 DLL 文件复制到扩展目录，然后在"已安装扩展"中启用</span>
      </div>
      
      <el-tabs v-model="extensionTab">
        <el-tab-pane label="已安装扩展" name="installed">
          <div v-if="loadingExtensions" class="loading-state">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>加载扩展列表...</span>
          </div>
          <div v-else-if="filteredInstalledExtensions.length === 0" class="empty-state small">
            <span v-if="extensionSearchKeyword">未找到匹配 "{{ extensionSearchKeyword }}" 的扩展</span>
            <span v-else>暂无已安装的扩展</span>
          </div>
          <div v-else class="extensions-list">
            <div class="extensions-count">
              共 {{ filteredInstalledExtensions.length }} 个扩展
              <span v-if="extensionSearchKeyword">（搜索自 {{ extensions.length }} 个）</span>
            </div>
            <div 
              v-for="ext in filteredInstalledExtensions" 
              :key="ext.name"
              class="extension-item"
            >
              <div class="ext-info">
                <span class="ext-name" v-html="highlightKeyword(ext.name)"></span>
                <el-tag :type="ext.enabled ? 'success' : 'info'" size="small">
                  {{ ext.enabled ? '已启用' : '已禁用' }}
                </el-tag>
              </div>
              <el-switch 
                v-model="ext.enabled"
                @change="(val) => toggleExtension(ext.name, val as boolean)"
              />
            </div>
          </div>
        </el-tab-pane>
        
        <el-tab-pane label="在线安装" name="available">
          <div v-if="loadingAvailableExtensions" class="loading-state">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>正在搜索可用扩展...</span>
          </div>
          <div v-else-if="availableExtensions.length === 0" class="empty-state small">
            <span v-if="extensionSearchKeyword">未找到适用于 PHP {{ currentVersion }} 的 "{{ extensionSearchKeyword }}" 扩展</span>
            <span v-else>输入关键词搜索扩展，或点击下方按钮加载推荐扩展</span>
            <el-button type="primary" size="small" @click="loadAvailableExtensionsData()" class="mt-2">
              加载推荐扩展
            </el-button>
          </div>
          <div v-else class="extensions-list">
            <div class="extensions-count">
              找到 {{ availableExtensions.length }} 个适用于 PHP {{ currentVersion }} 的扩展
            </div>
            <div 
              v-for="ext in availableExtensions" 
              :key="ext.name"
              class="extension-item"
            >
              <div class="ext-info">
                <div class="ext-main">
                  <span class="ext-name" v-html="highlightKeyword(ext.name)"></span>
                  <el-tag type="warning" size="small">v{{ ext.version }}</el-tag>
                </div>
                <span class="ext-desc" v-if="ext.description">{{ ext.description }}</span>
              </div>
              <el-button 
                type="primary" 
                size="small" 
                @click="installExtension(ext)"
                :loading="installingExtension === ext.name"
              >
                {{ installingExtension === ext.name ? '安装中...' : '安装' }}
              </el-button>
            </div>
          </div>
          <!-- 扩展下载进度条 -->
          <div v-if="installingExtension && extDownloadProgress.total > 0" class="download-progress mt-3">
            <div class="progress-info">
              <span>正在下载 {{ installingExtension }}...</span>
              <span>{{ formatSize(extDownloadProgress.downloaded) }} / {{ formatSize(extDownloadProgress.total) }}</span>
            </div>
            <el-progress :percentage="extDownloadProgress.progress" :stroke-width="8" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>

    <!-- 配置编辑对话框 -->
    <el-dialog 
      v-model="showConfigDialog" 
      title="编辑 php.ini"
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

    <!-- 日志查看器 -->
    <LogViewer v-model="showLogViewer" initial-tab="php" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, InfoFilled, VideoPlay, VideoPause, EditPen } from '@element-plus/icons-vue'
import { useServiceStore } from '@/stores/serviceStore'
import LogViewer from '@/components/LogViewer.vue'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'PhpManager'
})

const store = useServiceStore()

interface PhpVersion {
  version: string
  path: string
  isActive: boolean
}

interface AvailableVersion {
  version: string
  downloadUrl: string
  type: string
  arch: string
}

interface Extension {
  name: string
  enabled: boolean
  installed: boolean
}

interface AvailableExtension {
  name: string
  version: string
  downloadUrl: string
  description?: string
  packageName?: string  // Packagist 包名，用于 PIE 安装
}

const loading = ref(false)
const initialLoaded = ref(false)  // 标记是否已完成首次加载
const installedVersions = ref<PhpVersion[]>([])
const availableVersions = ref<AvailableVersion[]>([])
const showInstallDialog = ref(false)
const selectedVersion = ref('')
const installing = ref(false)
const downloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})

// CGI 状态管理
interface CgiStatus {
  version: string
  port: number
  running: boolean
}
const cgiStatus = ref<CgiStatus[]>([])
const cgiLoading = ref<Record<string, boolean>>({})

// 获取指定版本的 CGI 状态
const getCgiStatus = (version: string): CgiStatus | undefined => {
  return cgiStatus.value.find(s => s.version === version)
}

// 判断 CGI 是否运行中
const isCgiRunning = (version: string): boolean => {
  return getCgiStatus(version)?.running ?? false
}

// 获取 CGI 端口
const getCgiPort = (version: string): number => {
  return getCgiStatus(version)?.port ?? 9000
}

const showExtensionsDialog = ref(false)
const loadingExtensions = ref(false)
const extensions = ref<Extension[]>([])
const currentVersion = ref('')
const extensionTab = ref('installed')
const loadingAvailableExtensions = ref(false)
const availableExtensions = ref<AvailableExtension[]>([])
const installingExtension = ref('')
const extDownloadProgress = reactive({
  progress: 0,
  downloaded: 0,
  total: 0
})
const extensionSearchKeyword = ref('')

// 过滤后的已安装扩展列表
const filteredInstalledExtensions = computed(() => {
  if (!extensionSearchKeyword.value) {
    return extensions.value
  }
  const keyword = extensionSearchKeyword.value.toLowerCase()
  return extensions.value.filter(ext => 
    ext.name.toLowerCase().includes(keyword)
  )
})

// 过滤后的可安装扩展列表
const filteredAvailableExtensions = computed(() => {
  if (!extensionSearchKeyword.value) {
    return availableExtensions.value
  }
  const keyword = extensionSearchKeyword.value.toLowerCase()
  return availableExtensions.value.filter(ext => 
    ext.name.toLowerCase().includes(keyword)
  )
})

// 高亮搜索关键词
const highlightKeyword = (text: string) => {
  if (!extensionSearchKeyword.value) return text
  const keyword = extensionSearchKeyword.value
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark class="search-highlight">$1</mark>')
}

const showConfigDialog = ref(false)
const configContent = ref('')
const savingConfig = ref(false)

// 日志查看器
const showLogViewer = ref(false)

const showLogViewerDialog = () => {
  showLogViewer.value = true
}

// Composer 相关
const composerStatus = ref<{
  installed: boolean
  version?: string
  path?: string
  mirror?: string
}>({ installed: false })
const installingComposer = ref(false)
const uninstallingComposer = ref(false)
const showMirrorDialog = ref(false)
const selectedMirror = ref('')
const settingMirror = ref(false)

const loadVersions = async () => {
  try {
    installedVersions.value = await window.electronAPI?.php.getVersions() || []
    // 同步更新全局状态
    store.refreshPhpVersions()
    store.refreshServiceStatus()
  } catch (error: any) {
    console.error('加载版本失败:', error)
  }
}

// 加载 CGI 状态
const loadCgiStatus = async () => {
  try {
    cgiStatus.value = await window.electronAPI?.service.getPhpCgiStatus() || []
  } catch (error: any) {
    console.error('加载 CGI 状态失败:', error)
  }
}

// 启动 CGI
const startCgi = async (version: string) => {
  cgiLoading.value[version] = true
  try {
    const result = await window.electronAPI?.service.startPhpCgiVersion(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadCgiStatus()
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error('启动失败: ' + error.message)
  } finally {
    cgiLoading.value[version] = false
  }
}

// 停止 CGI
const stopCgi = async (version: string) => {
  cgiLoading.value[version] = true
  try {
    const result = await window.electronAPI?.service.stopPhpCgiVersion(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadCgiStatus()
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error('停止失败: ' + error.message)
  } finally {
    cgiLoading.value[version] = false
  }
}

// Composer 相关方法
const loadComposerStatus = async () => {
  try {
    composerStatus.value = await window.electronAPI?.composer?.getStatus() || { installed: false }
    selectedMirror.value = composerStatus.value.mirror || ''
  } catch (error: any) {
    console.error('加载 Composer 状态失败:', error)
  }
}

const installComposer = async () => {
  installingComposer.value = true
  try {
    const result = await window.electronAPI?.composer?.install()
    if (result?.success) {
      ElMessage.success(result.message)
      await loadComposerStatus()
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error('安装失败: ' + error.message)
  } finally {
    installingComposer.value = false
  }
}

const uninstallComposer = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要卸载 Composer 吗？',
      '确认卸载',
      { type: 'warning' }
    )
    
    uninstallingComposer.value = true
    const result = await window.electronAPI?.composer?.uninstall()
    if (result?.success) {
      ElMessage.success(result.message)
      await loadComposerStatus()
    } else {
      ElMessage.error(result?.message || '卸载失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('卸载失败: ' + error.message)
    }
  } finally {
    uninstallingComposer.value = false
  }
}

const setMirror = async () => {
  settingMirror.value = true
  try {
    const result = await window.electronAPI?.composer?.setMirror(selectedMirror.value)
    if (result?.success) {
      ElMessage.success(result.message)
      showMirrorDialog.value = false
      await loadComposerStatus()
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error('设置失败: ' + error.message)
  } finally {
    settingMirror.value = false
  }
}

const getMirrorDisplayName = (mirror?: string) => {
  if (!mirror) return '官方源'
  const mirrors: Record<string, string> = {
    'https://mirrors.aliyun.com/composer/': '阿里云镜像',
    'https://mirrors.cloud.tencent.com/composer/': '腾讯云镜像',
    'https://mirrors.huaweicloud.com/repository/php/': '华为云镜像',
    'https://packagist.phpcomposer.com': '中国全量镜像'
  }
  return mirrors[mirror] || mirror
}

const loadingAvailableVersions = ref(false)

const loadAvailableVersions = async () => {
  loadingAvailableVersions.value = true
  try {
    availableVersions.value = await window.electronAPI?.php.getAvailableVersions() || []
  } catch (error: any) {
    ElMessage.error('加载可用版本失败: ' + error.message)
  } finally {
    loadingAvailableVersions.value = false
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
    const result = await window.electronAPI?.php.install(selectedVersion.value)
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
      `确定要卸载 PHP ${version} 吗？此操作不可恢复。`,
      '确认卸载',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.php.uninstall(version)
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
  try {
    const result = await window.electronAPI?.php.setActive(version)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadVersions()
      // 刷新 Composer 状态（因为默认 PHP 改变了）
      await loadComposerStatus()
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const showExtensions = async (version: PhpVersion) => {
  currentVersion.value = version.version
  showExtensionsDialog.value = true
  extensionTab.value = 'installed'
  extensionSearchKeyword.value = '' // 重置搜索
  loadingExtensions.value = true
  
  try {
    extensions.value = await window.electronAPI?.php.getExtensions(version.version) || []
  } catch (error: any) {
    ElMessage.error('加载扩展失败: ' + error.message)
  } finally {
    loadingExtensions.value = false
  }
  
  // 异步加载可安装扩展列表
  loadAvailableExtensionsData()
}

const loadAvailableExtensionsData = async (searchKeyword?: string) => {
  if (!currentVersion.value) return
  
  loadingAvailableExtensions.value = true
  availableExtensions.value = []
  
  try {
    const result = await window.electronAPI?.php.getAvailableExtensions(
      currentVersion.value, 
      searchKeyword || undefined
    )
    availableExtensions.value = result || []
  } catch (error: any) {
    console.error('加载可用扩展失败:', error)
    ElMessage.error('加载扩展列表失败')
  } finally {
    loadingAvailableExtensions.value = false
  }
}

const searchExtensions = () => {
  if (extensionTab.value === 'available') {
    loadAvailableExtensionsData(extensionSearchKeyword.value)
  }
}

// 打开扩展目录（用于手动安装）
const openExtensionDir = async () => {
  if (!currentVersion.value) {
    ElMessage.warning('请先选择 PHP 版本')
    return
  }
  
  try {
    const result = await window.electronAPI?.php.openExtensionDir(currentVersion.value)
    if (result?.success) {
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '打开失败')
    }
  } catch (error: any) {
    ElMessage.error('打开扩展目录失败: ' + error.message)
  }
}

const installExtension = async (ext: AvailableExtension) => {
  installingExtension.value = ext.name
  extDownloadProgress.progress = 0
  extDownloadProgress.downloaded = 0
  extDownloadProgress.total = 0
  
  try {
    // 使用 PIE 安装（优先使用 packageName）
    const result = await window.electronAPI?.php.installExtension(
      currentVersion.value, 
      ext.name, 
      ext.downloadUrl,
      ext.packageName  // 传递 Packagist 包名给 PIE
    )
    
    if (result?.success) {
      ElMessage.success(result.message)
      // 刷新已安装扩展列表
      extensions.value = await window.electronAPI?.php.getExtensions(currentVersion.value) || []
      // 刷新可安装扩展列表
      await loadAvailableExtensionsData()
    } else {
      ElMessage.error(result?.message || '安装失败')
    }
  } catch (error: any) {
    ElMessage.error('安装失败: ' + error.message)
  } finally {
    installingExtension.value = ''
    extDownloadProgress.progress = 0
    extDownloadProgress.downloaded = 0
    extDownloadProgress.total = 0
  }
}

const toggleExtension = async (extName: string, enable: boolean) => {
  try {
    let result
    if (enable) {
      result = await window.electronAPI?.php.enableExtension(currentVersion.value, extName)
    } else {
      result = await window.electronAPI?.php.disableExtension(currentVersion.value, extName)
    }
    
    if (result?.success) {
      ElMessage.success(result.message)
      // 刷新扩展列表以获取最新状态
      extensions.value = await window.electronAPI?.php.getExtensions(currentVersion.value) || []
    } else {
      ElMessage.error(result?.message || '操作失败')
      // 刷新列表恢复真实状态
      extensions.value = await window.electronAPI?.php.getExtensions(currentVersion.value) || []
    }
  } catch (error: any) {
    ElMessage.error(error.message)
    // 刷新列表恢复真实状态
    extensions.value = await window.electronAPI?.php.getExtensions(currentVersion.value) || []
  }
}

const showConfig = async (version: PhpVersion) => {
  currentVersion.value = version.version
  try {
    configContent.value = await window.electronAPI?.php.getConfig(version.version) || ''
    showConfigDialog.value = true
  } catch (error: any) {
    ElMessage.error('加载配置失败: ' + error.message)
  }
}

const saveConfig = async () => {
  savingConfig.value = true
  try {
    const result = await window.electronAPI?.php.saveConfig(currentVersion.value, configContent.value)
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

onMounted(async () => {
  // 使用 store 中的缓存数据进行首次渲染（避免闪烁）
  if (store.phpVersions.length > 0) {
    installedVersions.value = store.phpVersions.map(v => ({
      version: v.version,
      path: v.path,
      isActive: v.isActive
    }))
  }
  
  // 首次加载数据
  loading.value = installedVersions.value.length === 0
  
  await Promise.all([
    loadVersions(),
    loadCgiStatus(),
    loadComposerStatus()
  ])
  
  loading.value = false
  initialLoaded.value = true
  
  // 异步加载可用版本列表（不阻塞首屏）
  loadAvailableVersions()
  
  // 监听下载进度
  window.electronAPI?.onDownloadProgress((data: any) => {
    if (data.type === 'php') {
      downloadProgress.progress = data.progress
      downloadProgress.downloaded = data.downloaded
      downloadProgress.total = data.total
    } else if (data.type === 'php-ext') {
      extDownloadProgress.progress = data.progress
      extDownloadProgress.downloaded = data.downloaded
      extDownloadProgress.total = data.total
    }
  })
})

// 从缓存激活时静默刷新 CGI 状态
onActivated(async () => {
  if (initialLoaded.value) {
    await loadCgiStatus()
  }
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

.extensions-list {
  max-height: 400px;
  overflow-y: auto;
}

.extension-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  transition: background-color 0.2s;
  
  &:hover {
    background-color: var(--bg-hover);
  }
  
  &:last-child {
    border-bottom: none;
  }
  
  .ext-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    
    .ext-main {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .ext-name {
      font-family: 'Fira Code', monospace;
      font-weight: 500;
    }
    
    .ext-desc {
      font-size: 12px;
      color: var(--text-muted);
    }
  }
}

.empty-state.small {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.mb-3 {
  margin-bottom: 12px;
}

.mt-2 {
  margin-top: 8px;
}

.mt-3 {
  margin-top: 12px;
}

.manual-install-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(64, 158, 255, 0.08);
  border-radius: 8px;
  border: 1px dashed rgba(64, 158, 255, 0.3);
  
  .hint-text {
    font-size: 13px;
    color: #909399;
  }
}

.extension-search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  
  .extension-search {
    flex: 1;
    
    :deep(.el-input__wrapper) {
      border-radius: 10px;
    }
  }
}

.mb-2 {
  margin-bottom: 8px;
  
  a {
    color: var(--accent-color);
    text-decoration: none;
    
    &:hover {
      text-decoration: underline;
    }
  }
}

.extensions-count {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-light);
}

:deep(.search-highlight) {
  background-color: rgba(124, 58, 237, 0.3);
  color: var(--accent-color);
  padding: 0 2px;
  border-radius: 2px;
}

.code-editor {
  width: 100%;
  height: 500px;
}

// Composer 管理样式
.composer-status {
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

.mirror-info {
  padding: 12px 16px;
  background: var(--bg-input);
  border-radius: 8px;
  margin-top: 12px;
  
  .mirror-label {
    color: var(--text-secondary);
    margin-right: 8px;
  }
  
  .mirror-value {
    color: var(--accent-color);
    font-weight: 500;
  }
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

