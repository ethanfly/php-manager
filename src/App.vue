<template>
  <div class="app-container" :class="{ 'dark-mode': isDark }">
    <!-- 自定义标题栏 -->
    <div class="title-bar">
      <div class="title-bar-left">
        <div class="app-logo">
          <img src="/icon.svg" alt="logo" class="logo-icon" />
          <span class="app-name">PHPer 开发环境管理器</span>
        </div>
      </div>
      <div class="title-bar-right">
        <button class="title-btn" @click="toggleDark">
          <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
        </button>
        <button class="title-btn" @click="minimize">
          <el-icon><Minus /></el-icon>
        </button>
        <button class="title-btn" @click="maximize">
          <el-icon><FullScreen /></el-icon>
        </button>
        <button class="title-btn close-btn" @click="close">
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="main-container">
      <!-- 侧边栏 -->
      <aside class="sidebar">
        <nav class="nav-menu">
          <router-link 
            v-for="item in menuItems" 
            :key="item.path" 
            :to="item.path"
            class="nav-item"
            :class="{ active: $route.path === item.path }"
          >
            <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
            <span class="nav-label">{{ item.label }}</span>
            <span 
              v-if="item.service" 
              class="status-dot"
              :class="{ running: serviceStatus[item.service as keyof typeof serviceStatus] }"
            ></span>
          </router-link>
        </nav>

        <div class="sidebar-footer">
          <div class="quick-actions">
            <el-button type="success" @click="startAll" :loading="startingAll">
              <el-icon><VideoPlay /></el-icon>
              启动全部
            </el-button>
            <el-button type="danger" @click="stopAll" :loading="stoppingAll">
              <el-icon><VideoPause /></el-icon>
              停止全部
            </el-button>
          </div>
        </div>
      </aside>

      <!-- 内容区 -->
      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useServiceStore } from './stores/serviceStore'

const store = useServiceStore()

const isDark = ref(true)
const startingAll = ref(false)
const stoppingAll = ref(false)

// 从 store 获取服务状态
const serviceStatus = computed(() => ({
  nginx: store.serviceStatus.nginx,
  mysql: store.serviceStatus.mysql,
  redis: store.serviceStatus.redis
}))

const menuItems = [
  { path: '/', label: '仪表盘', icon: 'Odometer', service: null },
  { path: '/php', label: 'PHP 管理', icon: 'Files', service: null },
  { path: '/mysql', label: 'MySQL 管理', icon: 'Coin', service: 'mysql' },
  { path: '/nginx', label: 'Nginx 管理', icon: 'Connection', service: 'nginx' },
  { path: '/redis', label: 'Redis 管理', icon: 'Grid', service: 'redis' },
  { path: '/nodejs', label: 'Node.js 管理', icon: 'Promotion', service: null },
  { path: '/python', label: 'Python 管理', icon: 'Platform', service: null },
  { path: '/git', label: 'Git 管理', icon: 'Share', service: null },
  { path: '/sites', label: '站点管理', icon: 'Monitor', service: null },
  { path: '/hosts', label: 'Hosts 管理', icon: 'Document', service: null },
  { path: '/settings', label: '设置', icon: 'Setting', service: null }
]

let statusInterval: ReturnType<typeof setInterval> | null = null

// 窗口控制
const minimize = () => window.electronAPI?.minimize()
const maximize = () => window.electronAPI?.maximize()
const close = () => window.electronAPI?.close()

// 主题切换
const toggleDark = () => {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}

// 启动所有服务
const startAll = async () => {
  startingAll.value = true
  try {
    const result = await window.electronAPI?.service.startAll()
    if (result?.success) {
      ElMessage.success(result.message)
      // 延迟刷新状态，等待服务启动
      setTimeout(() => store.refreshServiceStatus(), 2000)
    } else {
      ElMessage.error(result?.message || '启动失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    startingAll.value = false
  }
}

// 停止所有服务
const stopAll = async () => {
  stoppingAll.value = true
  try {
    const result = await window.electronAPI?.service.stopAll()
    if (result?.success) {
      ElMessage.success(result.message)
      await store.refreshServiceStatus()
    } else {
      ElMessage.error(result?.message || '停止失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    stoppingAll.value = false
  }
}

onMounted(() => {
  document.documentElement.classList.add('dark')
  // 初始化加载所有状态
  store.refreshAll()
  // 每 5 秒刷新一次状态
  statusInterval = setInterval(() => store.refreshServiceStatus(), 5000)
})

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
})
</script>

<style lang="scss" scoped>
.app-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

.title-bar {
  height: 40px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-titlebar);
  border-bottom: 1px solid var(--border-color);
  -webkit-app-region: drag;
  padding: 0 12px;
}

.title-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-logo {
  display: flex;
  align-items: center;
  gap: 8px;

  .logo-icon {
    width: 24px;
    height: 24px;
  }

  .app-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  }
}

.title-bar-right {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.title-btn {
  width: 36px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.close-btn:hover {
    background: #e81123;
    color: white;
  }
}

.main-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
}

.nav-menu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-gradient);
    color: white;
    box-shadow: 0 4px 12px rgba(123, 97, 255, 0.3);
    
    .status-dot {
      border-color: rgba(255, 255, 255, 0.3);
    }
  }

  .nav-icon {
    font-size: 20px;
  }

  .nav-label {
    font-size: 14px;
    font-weight: 500;
    flex: 1;
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6b7280;
    border: 2px solid var(--bg-sidebar);
    transition: all 0.3s;
    
    &.running {
      background: #10b981;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
    }
  }
}

.sidebar-footer {
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 12px;

  :deep(.el-button) {
    width: 100% !important;
    height: 40px !important;
    min-width: 100% !important;
    max-width: 100% !important;
    font-size: 14px !important;
    justify-content: center !important;
    border-radius: 8px !important;
    padding: 0 16px !important;
    margin-left: 0 !important;
  }
  
  :deep(.el-button + .el-button) {
    margin-left: 0 !important;
  }
}

.content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  background: var(--bg-content);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

