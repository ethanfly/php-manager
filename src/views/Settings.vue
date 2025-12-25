<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Setting /></el-icon></span>
        设置
      </h1>
      <p class="page-description">配置应用程序和服务设置</p>
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

    <!-- 开机自启动 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Timer /></el-icon>
          开机自启动
        </span>
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
              <img src="/favicon.svg" alt="logo" />
            </div>
            <div class="app-details">
              <h2 class="app-title">PHPer 开发环境管理器</h2>
              <p class="app-version">版本 1.0.0</p>
              <p class="app-desc">
                一站式 PHP 开发环境管理工具，支持 PHP、MySQL、Nginx、Redis 的安装和管理。
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
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

interface ServiceAutoStart {
  name: string
  displayName: string
  description: string
  autoStart: boolean
}

const basePath = ref('')
const services = reactive<ServiceAutoStart[]>([
  { name: 'nginx', displayName: 'Nginx', description: '开机时自动启动 Nginx 服务', autoStart: false },
  { name: 'mysql', displayName: 'MySQL', description: '开机时自动启动 MySQL 服务', autoStart: false },
  { name: 'redis', displayName: 'Redis', description: '开机时自动启动 Redis 服务', autoStart: false },
  { name: 'php-cgi', displayName: 'PHP-CGI', description: '开机时自动启动 PHP FastCGI 进程', autoStart: false }
])

const loadSettings = async () => {
  try {
    basePath.value = await window.electronAPI?.config.getBasePath() || ''
    
    // 加载自启动设置
    for (const service of services) {
      service.autoStart = await window.electronAPI?.service.getAutoStart(service.name) || false
    }
  } catch (error: any) {
    console.error('加载设置失败:', error)
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

