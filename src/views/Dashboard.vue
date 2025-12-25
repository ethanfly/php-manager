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
                :href="(site.ssl ? 'https://' : 'http://') + site.domain" 
                target="_blank" 
                class="site-domain-link"
                @click.stop
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
        <el-button size="small" @click="openBasePath">
          <el-icon><FolderOpened /></el-icon>
          打开目录
        </el-button>
      </div>
      <div class="card-content">
        <div class="path-display">
          <span class="path-label">基础路径：</span>
          <code class="path-value">{{ basePath }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, Promotion } from '@element-plus/icons-vue'

interface Service {
  name: string
  displayName: string
  icon: string
  gradient: string
  running: boolean
  loading: boolean
}

const services = reactive<Service[]>([
  { name: 'nginx', displayName: 'Nginx', icon: 'Connection', gradient: 'linear-gradient(135deg, #009639 0%, #0ecc5a 100%)', running: false, loading: false },
  { name: 'mysql', displayName: 'MySQL', icon: 'Coin', gradient: 'linear-gradient(135deg, #00758f 0%, #00b4d8 100%)', running: false, loading: false },
  { name: 'redis', displayName: 'Redis', icon: 'Grid', gradient: 'linear-gradient(135deg, #dc382d 0%, #ff6b6b 100%)', running: false, loading: false }
])

const phpVersions = ref<any[]>([])
const nodeVersions = ref<any[]>([])
const sites = ref<any[]>([])
const basePath = ref('')
const settingPhp = ref('')
const settingNode = ref('')

const loadData = async () => {
  try {
    // 加载服务状态
    const allServices = await window.electronAPI?.service.getAll()
    if (allServices) {
      for (const svc of allServices) {
        const found = services.find(s => s.name === svc.name || svc.name.startsWith(s.name))
        if (found) {
          found.running = svc.running
        }
      }
    }

    // 加载 PHP 版本
    phpVersions.value = await window.electronAPI?.php.getVersions() || []

    // 加载 Node.js 版本
    nodeVersions.value = await window.electronAPI?.node.getVersions() || []

    // 加载站点
    sites.value = await window.electronAPI?.nginx.getSites() || []

    // 加载基础路径
    basePath.value = await window.electronAPI?.config.getBasePath() || ''
  } catch (error: any) {
    console.error('加载数据失败:', error)
  }
}

const startService = async (service: Service) => {
  service.loading = true
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
      service.running = true
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    service.loading = false
  }
}

const stopService = async (service: Service) => {
  service.loading = true
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
      service.running = false
      ElMessage.success(result.message)
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    service.loading = false
  }
}

const restartService = async (service: Service) => {
  service.loading = true
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
    service.loading = false
  }
}

const openBasePath = async () => {
  if (basePath.value) {
    await window.electronAPI?.openPath(basePath.value)
  }
}

const setActivePhp = async (version: string) => {
  settingPhp.value = version
  try {
    const result = await window.electronAPI?.php.setActive(version)
    if (result?.success) {
      ElMessage.success(result.message)
      // 刷新 PHP 版本列表
      phpVersions.value = await window.electronAPI?.php.getVersions() || []
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
      // 刷新 Node.js 版本列表
      nodeVersions.value = await window.electronAPI?.node.getVersions() || []
    } else {
      ElMessage.error(result?.message || '设置失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    settingNode.value = ''
  }
}

onMounted(() => {
  loadData()
  // 每 10 秒刷新一次状态
  setInterval(loadData, 10000)
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
</style>

