<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Odometer /></el-icon></span>
        仪表盘
      </h1>
      <p class="page-description">服务状态概览与快捷操作</p>
    </div>

    <!-- 服务状态卡片 -->
    <div class="status-grid">
      <div 
        v-for="service in services" 
        :key="service.name" 
        class="status-card"
        :class="{ running: service.running }"
      >
        <div class="status-header">
          <div class="service-icon" :style="{ background: service.gradient }">
            <el-icon><component :is="service.icon" /></el-icon>
          </div>
          <div class="service-info">
            <h3 class="service-name">{{ service.displayName }}</h3>
            <span class="status-tag" :class="service.running ? 'running' : 'stopped'">
              <span class="status-dot"></span>
              {{ service.running ? '运行中' : '已停止' }}
            </span>
          </div>
        </div>
        <div class="status-actions">
          <el-button 
            v-if="!service.running" 
            type="success" 
            size="small" 
            @click="startService(service)"
            :loading="service.loading"
          >
            <el-icon><VideoPlay /></el-icon>
            启动
          </el-button>
          <el-button 
            v-else 
            type="danger" 
            size="small" 
            @click="stopService(service)"
            :loading="service.loading"
          >
            <el-icon><VideoPause /></el-icon>
            停止
          </el-button>
          <el-button 
            size="small" 
            @click="restartService(service)"
            :loading="service.loading"
            :disabled="!service.running"
          >
            <el-icon><RefreshRight /></el-icon>
            重启
          </el-button>
        </div>
      </div>
    </div>

    <!-- PHP-CGI 服务状态卡片 -->
    <div v-if="phpCgiServices.length > 0" class="php-cgi-section">
      <div class="section-header">
        <h2 class="section-title">
          <el-icon><Files /></el-icon>
          PHP-CGI 进程
        </h2>
        <div class="section-actions">
          <el-button type="success" size="small" @click="startAllPhpCgi">
            <el-icon><VideoPlay /></el-icon>
            全部启动
          </el-button>
          <el-button type="danger" size="small" @click="stopAllPhpCgi">
            <el-icon><VideoPause /></el-icon>
            全部停止
          </el-button>
        </div>
      </div>
      <div class="status-grid">
        <div 
          v-for="service in phpCgiServices" 
          :key="service.name" 
          class="status-card php-cgi-card"
          :class="{ running: service.running }"
        >
          <div class="status-header">
            <div class="service-icon" :style="{ background: service.gradient }">
              <el-icon><component :is="service.icon" /></el-icon>
            </div>
            <div class="service-info">
              <h3 class="service-name">{{ service.displayName }}</h3>
              <div class="port-info">端口: {{ service.port }}</div>
              <span class="status-tag" :class="service.running ? 'running' : 'stopped'">
                <span class="status-dot"></span>
                {{ service.running ? '运行中' : '已停止' }}
              </span>
            </div>
          </div>
          <div class="status-actions">
            <el-button 
              v-if="!service.running" 
              type="success" 
              size="small" 
              @click="startPhpCgi(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPlay /></el-icon>
              启动
            </el-button>
            <el-button 
              v-else 
              type="danger" 
              size="small" 
              @click="stopPhpCgi(service)"
              :loading="service.loading"
            >
              <el-icon><VideoPause /></el-icon>
              停止
            </el-button>
            <el-button 
              size="small" 
              @click="restartPhpCgi(service)"
              :loading="service.loading"
              :disabled="!service.running"
            >
              <el-icon><RefreshRight /></el-icon>
              重启
            </el-button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="php-cgi-empty">
      <el-alert type="info" :closable="false">
        <template #title>
          暂未安装 PHP，请先到 <router-link to="/php">PHP 管理</router-link> 安装 PHP 版本
        </template>
      </el-alert>
    </div>

    <!-- 快捷信息 -->
    <div class="info-grid">
      <!-- PHP 版本 -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <el-icon><Files /></el-icon>
            PHP 版本
          </span>
          <router-link to="/php" class="view-more">
            管理 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <div class="card-content">
          <div v-if="phpVersions.length > 0" class="version-list">
            <div 
              v-for="version in phpVersions" 
              :key="version.version"
              class="mini-version-card"
              :class="{ active: version.isActive }"
            >
              <span class="version-number">PHP {{ version.version }}</span>
              <div class="version-actions">
                <el-tag v-if="version.isActive" type="success" size="small">当前</el-tag>
                <el-button 
                  v-else 
                  type="primary" 
                  size="small" 
                  @click="setActivePhp(version.version)"
                  :loading="settingPhp === version.version"
                >
                  设为默认
                </el-button>
              </div>
            </div>
          </div>
          <div v-else class="empty-hint">
            <span>暂未安装 PHP</span>
            <router-link to="/php">去安装</router-link>
          </div>
        </div>
      </div>

      <!-- Node.js 版本 -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <el-icon><Promotion /></el-icon>
            Node.js 版本
          </span>
          <router-link to="/nodejs" class="view-more">
            管理 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <div class="card-content">
          <div v-if="nodeVersions.length > 0" class="version-list">
            <div 
              v-for="version in nodeVersions" 
              :key="version.version"
              class="mini-version-card"
              :class="{ active: version.isActive }"
            >
              <span class="version-number">Node {{ version.version }}</span>
              <div class="version-actions">
                <el-tag v-if="version.isActive" type="success" size="small">当前</el-tag>
                <el-button 
                  v-else 
                  type="primary" 
                  size="small" 
                  @click="setActiveNode(version.version)"
                  :loading="settingNode === version.version"
                >
                  设为默认
                </el-button>
              </div>
            </div>
          </div>
          <div v-else class="empty-hint">
            <span>暂未安装 Node.js</span>
            <router-link to="/nodejs">去安装</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- 站点信息 -->
    <div class="info-grid single">
      <!-- 站点列表 -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <el-icon><Monitor /></el-icon>
            站点列表
          </span>
          <router-link to="/sites" class="view-more">
            管理 <el-icon><ArrowRight /></el-icon>
          </router-link>
        </div>
        <div class="card-content">
          <div v-if="sites.length > 0" class="site-list">
            <div 
              v-for="site in sites.slice(0, 5)" 
              :key="site.name"
              class="mini-site-card"
            >
              <a 
                href="#"
                class="site-domain-link"
                @click.prevent="openSite(site)"
              >
                {{ site.domain }}
                <el-icon class="link-icon"><Link /></el-icon>
              </a>
              <div class="site-tags">
                <el-tag v-if="site.ssl" type="success" size="small">SSL</el-tag>
                <el-tag v-if="site.isLaravel" type="warning" size="small">Laravel</el-tag>
              </div>
            </div>
          </div>
          <div v-else class="empty-hint">
            <span>暂无站点</span>
            <router-link to="/sites">添加站点</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- 系统信息 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><InfoFilled /></el-icon>
          安装路径
        </span>
        <div class="card-actions">
          <el-button size="small" @click="showLogViewer = true">
            <el-icon><Document /></el-icon>
            查看日志
          </el-button>
          <el-button size="small" @click="openBasePath">
            <el-icon><FolderOpened /></el-icon>
            打开目录
          </el-button>
        </div>
      </div>
      <div class="card-content">
        <div class="path-display">
          <span class="path-label">基础路径：</span>
          <code class="path-value">{{ basePath }}</code>
        </div>
      </div>
    </div>

    <!-- 日志查看器 -->
    <LogViewer v-model="showLogViewer" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, Promotion, Document } from '@element-plus/icons-vue'
import { useServiceStore } from '@/stores/serviceStore'
import LogViewer from '@/components/LogViewer.vue'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'Dashboard'
})

const store = useServiceStore()

interface Service {
  name: string
  displayName: string
  icon: string
  gradient: string
  running: boolean
  loading: boolean
  version?: string  // 用于 PHP-CGI 显示版本
  port?: number     // 用于 PHP-CGI 显示端口
}

// 基础服务列表配置
const baseServiceConfigs = [
  { name: 'nginx', displayName: 'Nginx', icon: 'Connection', gradient: 'linear-gradient(135deg, #009639 0%, #0ecc5a 100%)' },
  { name: 'mysql', displayName: 'MySQL', icon: 'Coin', gradient: 'linear-gradient(135deg, #00758f 0%, #00b4d8 100%)' },
  { name: 'redis', displayName: 'Redis', icon: 'Grid', gradient: 'linear-gradient(135deg, #dc382d 0%, #ff6b6b 100%)' }
]

// 服务加载状态
const serviceLoadingState = ref<Record<string, boolean>>({})

// 从 store 计算基础服务列表
const services = computed<Service[]>(() => {
  return baseServiceConfigs.map(config => ({
    ...config,
    running: store.serviceStatus[config.name as keyof typeof store.serviceStatus] as boolean,
    loading: serviceLoadingState.value[config.name] || false
  }))
})

// 从 store 计算 PHP-CGI 服务列表
const phpCgiServices = computed<Service[]>(() => {
  return store.serviceStatus.phpCgi.map(status => ({
    name: `php-cgi-${status.version}`,
    displayName: `PHP ${status.version}`,
    icon: 'Files',
    gradient: 'linear-gradient(135deg, #777BB4 0%, #9b8ed4 100%)',
    running: status.running,
    loading: serviceLoadingState.value[`php-cgi-${status.version}`] || false,
    version: status.version,
    port: status.port
  }))
})

// 从 store 获取数据
const phpVersions = computed(() => store.phpVersions)
const nodeVersions = computed(() => store.nodeVersions)
const sites = computed(() => store.sites)
const basePath = computed(() => store.basePath)

const settingPhp = ref('')
const settingNode = ref('')
const showLogViewer = ref(false)

const startService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.start()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.start(versions[0].version)
      } else {
        result = { success: false, message: 'MySQL 未安装' }
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.start()
    }

    if (result?.success) {
      store.updateServiceStatus(service.name as 'nginx' | 'mysql' | 'redis', true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const startPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    const result = await window.electronAPI?.service.startPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

const stopService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.stop()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.stop(versions[0].version)
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.stop()
    }

    if (result?.success) {
      store.updateServiceStatus(service.name as 'nginx' | 'mysql' | 'redis', false)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const stopPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    const result = await window.electronAPI?.service.stopPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, false)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

const restartService = async (service: Service) => {
  serviceLoadingState.value[service.name] = true
  try {
    let result
    if (service.name === 'nginx') {
      result = await window.electronAPI?.nginx.restart()
    } else if (service.name === 'mysql') {
      const versions = await window.electronAPI?.mysql.getVersions()
      if (versions?.length > 0) {
        result = await window.electronAPI?.mysql.restart(versions[0].version)
      }
    } else if (service.name === 'redis') {
      result = await window.electronAPI?.redis.restart()
    }

    if (result?.success) {
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[service.name] = false
  }
}

const restartPhpCgi = async (service: Service) => {
  const key = `php-cgi-${service.version}`
  serviceLoadingState.value[key] = true
  try {
    // PHP-CGI 重启：先停止再启动
    await window.electronAPI?.service.stopPhpCgiVersion(service.version!)
    await new Promise(resolve => setTimeout(resolve, 500))
    const result = await window.electronAPI?.service.startPhpCgiVersion(service.version!)
    if (result?.success) {
      store.updatePhpCgiStatus(service.version!, true)
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '重启失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    serviceLoadingState.value[key] = false
  }
}

// 启动全部 PHP-CGI
const startAllPhpCgi = async () => {
  try {
    const result = await window.electronAPI?.service.startAllPhpCgi()
    if (result?.success) {
      ElMessage.success('全部 PHP-CGI 已启动')
      // 更新所有 PHP-CGI 状态为运行中
      store.serviceStatus.phpCgi.forEach(p => p.running = true)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

// 停止全部 PHP-CGI
const stopAllPhpCgi = async () => {
  try {
    const result = await window.electronAPI?.service.stopAllPhpCgi()
    if (result?.success) {
      ElMessage.success('全部 PHP-CGI 已停止')
      // 更新所有 PHP-CGI 状态为已停止
      store.serviceStatus.phpCgi.forEach(p => p.running = false)
    } else {
      ElMessage.error(result?.message || '停止失败')
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

// 在默认浏览器中打开站点
const openSite = (site: { domain: string, ssl: boolean }) => {
  const protocol = site.ssl ? 'https' : 'http'
  window.electronAPI?.openExternal(`${protocol}://${site.domain}`)
}

const setActivePhp = async (version: string) => {
  settingPhp.value = version
  try {
    const result = await window.electronAPI?.php.setActive(version)
    if (result?.success) {
      ElMessage.success(result.message)
      // 刷新全局 PHP 版本列表
      await store.refreshPhpVersions()
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    settingPhp.value = ''
  }
}

const setActiveNode = async (version: string) => {
  settingNode.value = version
  try {
    const result = await window.electronAPI?.node.setActive(version)
    if (result?.success) {
      ElMessage.success(result.message)
      // 刷新全局 Node.js 版本列表
      await store.refreshNodeVersions()
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    settingNode.value = ''
  }
}

onMounted(async () => {
  // 首次加载：如果没有数据则全量刷新
  if (store.phpVersions.length === 0 && store.nodeVersions.length === 0) {
    await store.refreshAll()
  }
})

// 从缓存激活时静默刷新状态（不会闪烁因为已有数据）
onActivated(async () => {
  await store.refreshServiceStatus()
})
</script>

<style lang="scss" scoped>
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.status-card {
  background: var(--bg-card);
  border-radius: 16px;
  border: 1px solid var(--border-color);
  padding: 24px;
  transition: all 0.3s;
  
  &:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
  
  &.running {
    border-color: var(--success-color);
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.1);
  }
  
  .status-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
  }
  
  .service-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 28px;
  }
  
  .service-info {
    .service-name {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }
  }
  
  .status-actions {
    display: flex;
    gap: 8px;
  }
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
  
  &.single {
    grid-template-columns: 1fr;
  }
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-version-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-input);
  border-radius: 10px;
  border: 1px solid var(--border-color);
  
  &.active {
    border-color: var(--accent-color);
    background: rgba(124, 58, 237, 0.05);
  }
  
  .version-number {
    font-weight: 500;
  }
  
  .version-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.site-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mini-site-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-input);
  border-radius: 10px;
  border: 1px solid var(--border-color);
  
  .site-domain-link {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-family: 'Fira Code', monospace;
    color: var(--accent-color);
    text-decoration: none;
    transition: all 0.2s;
    
    .link-icon {
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    
    &:hover {
      text-decoration: underline;
      
      .link-icon {
        opacity: 1;
      }
    }
  }
  
  .site-tags {
    display: flex;
    gap: 6px;
  }
}

.empty-hint {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  
  a {
    color: var(--accent-color);
    margin-left: 8px;
    text-decoration: none;
    
    &:hover {
      text-decoration: underline;
    }
  }
}

.view-more {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--accent-color);
  text-decoration: none;
  font-size: 13px;
  
  &:hover {
    text-decoration: underline;
  }
}

.path-display {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-input);
  border-radius: 10px;
  
  .path-label {
    color: var(--text-secondary);
  }
  
  .path-value {
    font-family: 'Fira Code', monospace;
    color: var(--accent-color);
  }
}

.no-php-hint {
  font-size: 13px;
  color: var(--text-muted);
  font-style: italic;
}

.php-cgi-section {
  margin-bottom: 24px;
  
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  
  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .section-actions {
    display: flex;
    gap: 8px;
  }
}

.php-cgi-card {
  .port-info {
    font-size: 12px;
    color: var(--text-muted);
    font-family: 'Fira Code', monospace;
    margin-bottom: 4px;
  }
}

.php-cgi-empty {
  margin-bottom: 24px;
  
  a {
    color: var(--accent-color);
    text-decoration: none;
    
    &:hover {
      text-decoration: underline;
    }
  }
}
</style>

