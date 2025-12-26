<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Monitor /></el-icon></span>
        站点管理
      </h1>
      <p class="page-description">创建和管理 Nginx 虚拟主机站点，支持 Laravel 项目和 SSL 证书</p>
    </div>

    <!-- 站点列表 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><Collection /></el-icon>
          站点列表
        </span>
        <div class="header-actions">
          <el-button @click="showLogViewer = true">
            <el-icon><Document /></el-icon>
            站点日志
          </el-button>
          <el-button type="success" @click="showCreateLaravelDialog = true">
            <el-icon><Promotion /></el-icon>
            创建 Laravel 项目
          </el-button>
          <el-button type="primary" @click="showAddSiteDialog = true">
            <el-icon><Plus /></el-icon>
            添加站点
          </el-button>
        </div>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else-if="sites.length === 0" class="empty-state">
          <el-icon class="empty-icon"><Monitor /></el-icon>
          <h3 class="empty-title">暂无站点</h3>
          <p class="empty-description">点击上方按钮添加第一个站点</p>
        </div>
        <div v-else class="sites-grid">
          <div 
            v-for="site in sites" 
            :key="site.name"
            class="site-card"
            :class="{ enabled: site.enabled }"
          >
            <div class="site-header">
              <div class="site-icon" :class="{ laravel: site.isLaravel }">
                <el-icon v-if="site.isLaravel"><Promotion /></el-icon>
                <el-icon v-else><Monitor /></el-icon>
              </div>
              <div class="site-main">
                <h3 class="site-name">{{ site.name }}</h3>
                <a class="site-domain" :href="`http://${site.domain}`" @click.prevent="openSite(site)">
                  {{ site.ssl ? 'https' : 'http' }}://{{ site.domain }}
                </a>
              </div>
            </div>
            <div class="site-meta">
              <span class="meta-item" v-if="site.isProxy">
                <el-icon><Link /></el-icon>
                {{ site.proxyTarget }}
              </span>
              <span class="meta-item" v-else>
                <el-icon><Folder /></el-icon>
                {{ site.rootPath }}
              </span>
              <span class="meta-item" v-if="!site.isProxy">
                <el-icon><Files /></el-icon>
                PHP {{ site.phpVersion }} (端口 {{ getPhpCgiPort(site.phpVersion) }})
              </span>
            </div>
            <div class="site-tags">
              <el-tag v-if="site.isProxy" type="primary" size="small">反向代理</el-tag>
              <el-tag v-if="site.isLaravel" type="warning" size="small">Laravel</el-tag>
              <el-tag v-if="site.ssl" type="success" size="small">SSL</el-tag>
              <el-tag :type="site.enabled ? 'success' : 'info'" size="small">
                {{ site.enabled ? '已启用' : '已禁用' }}
              </el-tag>
            </div>
            <div class="site-actions">
              <el-button 
                type="primary" 
                size="small" 
                @click="showEditDialog(site)"
              >
                编辑
              </el-button>
              <el-button 
                v-if="!site.enabled" 
                type="success" 
                size="small" 
                @click="enableSite(site.name)"
              >
                启用
              </el-button>
              <el-button 
                v-else 
                type="warning" 
                size="small" 
                @click="disableSite(site.name)"
              >
                禁用
              </el-button>
              <el-button size="small" @click="showSSLDialog(site)" v-if="!site.ssl">
                申请SSL
              </el-button>
              <el-button 
                type="danger" 
                size="small" 
                @click="removeSite(site.name)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加站点对话框 -->
    <el-dialog 
      v-model="showAddSiteDialog" 
      title="添加站点"
      width="600px"
    >
      <el-form :model="siteForm" label-width="100px">
        <el-form-item label="域名" required>
          <el-input v-model="siteForm.domain" placeholder="例如: myproject.test" @blur="autoFillName" />
        </el-form-item>
        <el-form-item label="站点名称">
          <el-input v-model="siteForm.name" placeholder="留空则使用域名作为名称" />
          <span class="form-hint">可选，默认使用域名</span>
        </el-form-item>
        <el-form-item label="根目录" required v-if="!siteForm.isProxy">
          <div class="directory-input">
            <el-input v-model="siteForm.rootPath" placeholder="点击右侧按钮选择目录" readonly />
            <el-button type="primary" @click="selectDirectory" :icon="FolderOpened">
              选择目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="PHP 版本" required v-if="!siteForm.isProxy">
          <el-select v-model="siteForm.phpVersion" placeholder="选择 PHP 版本">
            <el-option 
              v-for="v in phpVersions" 
              :key="v.version" 
              :label="`PHP ${v.version} (端口 ${getPhpCgiPort(v.version)})`" 
              :value="v.version" 
            />
          </el-select>
          <span class="form-hint">每个 PHP 版本使用独立端口的 FastCGI 进程</span>
        </el-form-item>
        <el-form-item label="反向代理">
          <el-switch v-model="siteForm.isProxy" @change="onProxyChange" />
          <span class="form-hint">开启后将作为反向代理服务器（用于 Node.js、Go 等应用）</span>
        </el-form-item>
        <el-form-item label="代理目标" v-if="siteForm.isProxy" required>
          <el-input v-model="siteForm.proxyTarget" placeholder="例如: http://127.0.0.1:3000" />
          <span class="form-hint">后端服务地址，支持 WebSocket</span>
        </el-form-item>
        <el-form-item label="Laravel 项目" v-if="!siteForm.isProxy">
          <el-switch v-model="siteForm.isLaravel" />
          <span class="form-hint">开启后将自动配置 Laravel 伪静态规则</span>
        </el-form-item>
        <el-form-item label="启用 SSL">
          <el-switch v-model="siteForm.ssl" />
          <span class="form-hint">需要先申请 SSL 证书</span>
        </el-form-item>
        <el-form-item label="添加 Hosts">
          <el-switch v-model="addToHosts" />
          <span class="form-hint">自动将域名添加到系统 hosts 文件</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddSiteDialog = false">取消</el-button>
        <el-button type="primary" @click="addSite" :loading="adding">
          添加站点
        </el-button>
      </template>
    </el-dialog>

    <!-- SSL 申请对话框 -->
    <el-dialog 
      v-model="showSSLDialogVisible" 
      title="申请 SSL 证书"
      width="500px"
    >
      <el-alert type="warning" :closable="false" class="mb-4">
        <template #title>
          Let's Encrypt 证书
        </template>
        需要确保域名已解析到本机，且 80 端口可访问。本地开发建议使用自签名证书。
      </el-alert>
      <el-form :model="sslForm" label-width="80px">
        <el-form-item label="域名">
          <el-input v-model="sslForm.domain" disabled />
        </el-form-item>
        <el-form-item label="邮箱" required>
          <el-input v-model="sslForm.email" placeholder="用于接收证书到期通知" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSSLDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="requestSSL" :loading="requestingSSL">
          申请证书
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑站点对话框 -->
    <el-dialog 
      v-model="showEditSiteDialog" 
      title="编辑站点"
      width="600px"
    >
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="域名" required>
          <el-input v-model="editForm.domain" placeholder="例如: myproject.test" />
        </el-form-item>
        <el-form-item label="站点名称">
          <el-input v-model="editForm.name" disabled />
          <span class="form-hint">站点名称不可修改</span>
        </el-form-item>
        <el-form-item label="反向代理">
          <el-switch v-model="editForm.isProxy" @change="onEditProxyChange" />
          <span class="form-hint">开启后将作为反向代理服务器</span>
        </el-form-item>
        <el-form-item label="代理目标" v-if="editForm.isProxy" required>
          <el-input v-model="editForm.proxyTarget" placeholder="例如: http://127.0.0.1:3000" />
          <span class="form-hint">后端服务地址，支持 WebSocket</span>
        </el-form-item>
        <el-form-item label="根目录" required v-if="!editForm.isProxy">
          <div class="directory-input">
            <el-input v-model="editForm.rootPath" placeholder="点击右侧按钮选择目录" readonly />
            <el-button type="primary" @click="selectEditDirectory" :icon="FolderOpened">
              选择目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="PHP 版本" required v-if="!editForm.isProxy">
          <el-select v-model="editForm.phpVersion" placeholder="选择 PHP 版本">
            <el-option 
              v-for="v in phpVersions" 
              :key="v.version" 
              :label="`PHP ${v.version} (端口 ${getPhpCgiPort(v.version)})`" 
              :value="v.version" 
            />
          </el-select>
          <span class="form-hint">修改后需重新加载 Nginx 配置</span>
        </el-form-item>
        <el-form-item label="Laravel 项目" v-if="!editForm.isProxy">
          <el-switch v-model="editForm.isLaravel" />
          <span class="form-hint">开启后将自动配置 Laravel 伪静态规则</span>
        </el-form-item>
        <el-form-item label="启用 SSL">
          <el-switch v-model="editForm.ssl" />
          <span class="form-hint">需要先申请 SSL 证书</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSiteDialog = false">取消</el-button>
        <el-button type="primary" @click="updateSite" :loading="updating">
          保存修改
        </el-button>
      </template>
    </el-dialog>

    <!-- 创建 Laravel 项目对话框 -->
    <el-dialog 
      v-model="showCreateLaravelDialog" 
      title="创建 Laravel 项目"
      width="600px"
    >
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          创建新的 Laravel 项目
        </template>
        将使用 Composer 创建 Laravel 项目，并自动配置站点。请确保已安装 Composer。
      </el-alert>
      <el-form :model="laravelForm" label-width="100px">
        <el-form-item label="项目名称" required>
          <el-input 
            v-model="laravelForm.projectName" 
            placeholder="例如: my-app"
            @input="autoGenerateDomain"
          />
          <span class="form-hint">将作为目录名和站点名称</span>
        </el-form-item>
        <el-form-item label="项目目录" required>
          <div class="directory-input">
            <el-input v-model="laravelForm.targetDir" placeholder="点击右侧按钮选择目录" readonly />
            <el-button type="primary" @click="selectLaravelDirectory" :icon="FolderOpened">
              选择目录
            </el-button>
          </div>
          <span class="form-hint">Laravel 项目将创建在此目录下</span>
        </el-form-item>
        <el-form-item label="域名" required>
          <el-input v-model="laravelForm.domain" placeholder="例如: my-app.test" />
          <span class="form-hint">本地开发域名，建议使用 .test 后缀</span>
        </el-form-item>
        <el-form-item label="PHP 版本" required>
          <el-select v-model="laravelForm.phpVersion" placeholder="选择 PHP 版本">
            <el-option 
              v-for="v in phpVersions" 
              :key="v.version" 
              :label="`PHP ${v.version} (端口 ${getPhpCgiPort(v.version)})`" 
              :value="v.version" 
            />
          </el-select>
        </el-form-item>
        <el-form-item label="添加 Hosts">
          <el-switch v-model="laravelForm.addToHosts" />
          <span class="form-hint">自动将域名添加到系统 hosts 文件</span>
        </el-form-item>
      </el-form>
      
      <!-- 创建进度 -->
      <div v-if="creatingLaravel" class="creating-progress">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在创建 Laravel 项目，这可能需要几分钟...</span>
      </div>
      
      <template #footer>
        <el-button @click="showCreateLaravelDialog = false" :disabled="creatingLaravel">取消</el-button>
        <el-button type="primary" @click="createLaravelProject" :loading="creatingLaravel">
          创建项目
        </el-button>
      </template>
    </el-dialog>

    <!-- 日志查看器 -->
    <LogViewer v-model="showLogViewer" initial-tab="sites" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened, Document } from '@element-plus/icons-vue'
import { useServiceStore } from '@/stores/serviceStore'
import LogViewer from '@/components/LogViewer.vue'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'SitesManager'
})

const store = useServiceStore()

interface SiteConfig {
  name: string
  domain: string
  rootPath: string
  phpVersion: string
  isLaravel: boolean
  ssl: boolean
  enabled: boolean
  isProxy?: boolean
  proxyTarget?: string
}

const loading = ref(false)
const sites = ref<SiteConfig[]>([])
const phpVersions = ref<any[]>([])
const showAddSiteDialog = ref(false)
const adding = ref(false)
const addToHosts = ref(true)

// 根据 PHP 版本计算 FastCGI 端口
const getPhpCgiPort = (version: string): number => {
  const match = version.match(/^(\d+)\.(\d+)/)
  if (match) {
    const major = parseInt(match[1])
    const minor = parseInt(match[2])
    return 9000 + major * 10 + minor  // 8.5 -> 9085, 8.4 -> 9084
  }
  return 9000
}

const siteForm = reactive<SiteConfig>({
  name: '',
  domain: '',
  rootPath: '',
  phpVersion: '',
  isLaravel: false,
  ssl: false,
  enabled: true,
  isProxy: false,
  proxyTarget: ''
})

const showSSLDialogVisible = ref(false)
const sslForm = reactive({
  domain: '',
  email: ''
})
const requestingSSL = ref(false)

// 编辑站点
const showEditSiteDialog = ref(false)
const updating = ref(false)
const editingOriginalName = ref('')
const editForm = reactive<SiteConfig>({
  name: '',
  domain: '',
  rootPath: '',
  phpVersion: '',
  isLaravel: false,
  ssl: false,
  enabled: true,
  isProxy: false,
  proxyTarget: ''
})

// 创建 Laravel 项目
const showCreateLaravelDialog = ref(false)
const creatingLaravel = ref(false)
const showLogViewer = ref(false)

const laravelForm = reactive({
  projectName: '',
  targetDir: '',
  domain: '',
  phpVersion: '',
  addToHosts: true
})

const loadData = async () => {
  try {
    sites.value = await window.electronAPI?.nginx.getSites() || []
    phpVersions.value = await window.electronAPI?.php.getVersions() || []
    
    // 默认选择第一个 PHP 版本
    if (phpVersions.value.length > 0) {
      if (!siteForm.phpVersion) {
        siteForm.phpVersion = phpVersions.value[0].version
      }
      if (!laravelForm.phpVersion) {
        laravelForm.phpVersion = phpVersions.value[0].version
      }
    }
    
    // 同步更新全局状态
    store.refreshSites()
    store.refreshPhpVersions()
  } catch (error: any) {
    console.error('加载数据失败:', error)
  }
}

// 选择目录
const selectDirectory = async () => {
  try {
    const path = await window.electronAPI?.selectDirectory()
    if (path) {
      siteForm.rootPath = path
    }
  } catch (error: any) {
    ElMessage.error('选择目录失败: ' + error.message)
  }
}

// 反向代理开关变化
const onProxyChange = (value: boolean) => {
  if (value) {
    // 开启反向代理时，清空不需要的字段
    siteForm.rootPath = ''
    siteForm.phpVersion = ''
    siteForm.isLaravel = false
    // 设置默认代理目标
    if (!siteForm.proxyTarget) {
      siteForm.proxyTarget = 'http://127.0.0.1:3000'
    }
  }
}

const onEditProxyChange = (value: boolean) => {
  if (value) {
    editForm.rootPath = ''
    editForm.phpVersion = ''
    editForm.isLaravel = false
    if (!editForm.proxyTarget) {
      editForm.proxyTarget = 'http://127.0.0.1:3000'
    }
  }
}

// 自动填充站点名称（当域名输入完成后）
const autoFillName = () => {
  if (!siteForm.name && siteForm.domain) {
    // 默认使用域名作为站点名称（移除 .test, .local 等后缀）
    siteForm.name = siteForm.domain.replace(/\.(test|local|dev|localhost)$/i, '')
  }
}

const addSite = async () => {
  // 站点名称默认为域名
  if (!siteForm.name && siteForm.domain) {
    siteForm.name = siteForm.domain.replace(/\.(test|local|dev|localhost)$/i, '')
  }
  
  // 根据站点类型验证必填字段
  if (siteForm.isProxy) {
    if (!siteForm.domain || !siteForm.proxyTarget) {
      ElMessage.warning('请填写所有必填字段（域名、代理目标）')
      return
    }
  } else {
    if (!siteForm.domain || !siteForm.rootPath || !siteForm.phpVersion) {
      ElMessage.warning('请填写所有必填字段（域名、根目录、PHP版本）')
      return
    }
  }
  
  // 最终确保有站点名称
  if (!siteForm.name) {
    siteForm.name = siteForm.domain
  }
  
  adding.value = true
  try {
    // 转换为普通对象（避免 IPC 序列化问题）
    const siteData = {
      name: siteForm.name,
      domain: siteForm.domain,
      rootPath: siteForm.rootPath,
      phpVersion: siteForm.phpVersion,
      isLaravel: siteForm.isLaravel,
      ssl: siteForm.ssl,
      enabled: siteForm.enabled,
      isProxy: siteForm.isProxy,
      proxyTarget: siteForm.proxyTarget
    }
    const result = await window.electronAPI?.nginx.addSite(siteData)
    if (result?.success) {
      // 添加到 hosts
      if (addToHosts.value) {
        await window.electronAPI?.hosts.add(siteForm.domain, '127.0.0.1')
      }
      
      ElMessage.success(result.message)
      showAddSiteDialog.value = false
      
      // 重置表单
      Object.assign(siteForm, {
        name: '',
        domain: '',
        rootPath: '',
        phpVersion: phpVersions.value[0]?.version || '',
        isLaravel: false,
        ssl: false,
        enabled: true,
        isProxy: false,
        proxyTarget: ''
      })
      
      // 重新加载 Nginx 配置
      await window.electronAPI?.nginx.reload()
      await loadData()
    } else {
      ElMessage.error(result?.message || '添加失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    adding.value = false
  }
}

const removeSite = async (name: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除站点 ${name} 吗？`,
      '确认删除',
      { type: 'warning' }
    )
    
    const site = sites.value.find(s => s.name === name)
    
    const result = await window.electronAPI?.nginx.removeSite(name)
    if (result?.success) {
      // 从 hosts 移除
      if (site) {
        await window.electronAPI?.hosts.remove(site.domain)
      }
      
      ElMessage.success(result.message)
      await window.electronAPI?.nginx.reload()
      await loadData()
    } else {
      ElMessage.error(result?.message || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

const enableSite = async (name: string) => {
  try {
    const result = await window.electronAPI?.nginx.enableSite(name)
    if (result?.success) {
      ElMessage.success(result.message)
      await window.electronAPI?.nginx.reload()
      await loadData()
    } else {
      ElMessage.error(result?.message || '启用失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const disableSite = async (name: string) => {
  try {
    const result = await window.electronAPI?.nginx.disableSite(name)
    if (result?.success) {
      ElMessage.success(result.message)
      await window.electronAPI?.nginx.reload()
      await loadData()
    } else {
      ElMessage.error(result?.message || '禁用失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

const openSite = (site: SiteConfig) => {
  const protocol = site.ssl ? 'https' : 'http'
  window.electronAPI?.openExternal(`${protocol}://${site.domain}`)
}

// 显示编辑对话框
const showEditDialog = (site: SiteConfig) => {
  editingOriginalName.value = site.name
  Object.assign(editForm, {
    name: site.name,
    domain: site.domain,
    rootPath: site.rootPath,
    phpVersion: site.phpVersion,
    isLaravel: site.isLaravel,
    ssl: site.ssl,
    enabled: site.enabled,
    isProxy: site.isProxy || false,
    proxyTarget: site.proxyTarget || ''
  })
  showEditSiteDialog.value = true
}

// 选择编辑目录
const selectEditDirectory = async () => {
  try {
    const path = await window.electronAPI?.selectDirectory()
    if (path) {
      editForm.rootPath = path
    }
  } catch (error: any) {
    ElMessage.error('选择目录失败: ' + error.message)
  }
}

// 更新站点
const updateSite = async () => {
  // 根据站点类型验证必填字段
  if (editForm.isProxy) {
    if (!editForm.domain || !editForm.proxyTarget) {
      ElMessage.warning('请填写所有必填字段（域名、代理目标）')
      return
    }
  } else {
    if (!editForm.domain || !editForm.rootPath || !editForm.phpVersion) {
      ElMessage.warning('请填写所有必填字段')
      return
    }
  }
  
  updating.value = true
  try {
    // 转换为普通对象
    const siteData = {
      name: editForm.name,
      domain: editForm.domain,
      rootPath: editForm.rootPath,
      phpVersion: editForm.phpVersion,
      isLaravel: editForm.isLaravel,
      ssl: editForm.ssl,
      enabled: editForm.enabled,
      isProxy: editForm.isProxy,
      proxyTarget: editForm.proxyTarget
    }
    
    const result = await window.electronAPI?.nginx.updateSite(editingOriginalName.value, siteData)
    if (result?.success) {
      ElMessage.success(result.message)
      showEditSiteDialog.value = false
      
      // 更新 hosts（如果域名变了）
      const oldSite = sites.value.find(s => s.name === editingOriginalName.value)
      if (oldSite && oldSite.domain !== editForm.domain) {
        await window.electronAPI?.hosts.remove(oldSite.domain)
        await window.electronAPI?.hosts.add(editForm.domain, '127.0.0.1')
      }
      
      // 重新加载
      await window.electronAPI?.nginx.reload()
      await loadData()
    } else {
      ElMessage.error(result?.message || '更新失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    updating.value = false
  }
}

const showSSLDialog = (site: SiteConfig) => {
  sslForm.domain = site.domain
  sslForm.email = ''
  showSSLDialogVisible.value = true
}

const requestSSL = async () => {
  if (!sslForm.email) {
    ElMessage.warning('请输入邮箱地址')
    return
  }
  
  requestingSSL.value = true
  try {
    const result = await window.electronAPI?.nginx.requestSSL(sslForm.domain, sslForm.email)
    if (result?.success) {
      ElMessage.success(result.message)
      showSSLDialogVisible.value = false
      await loadData()
    } else {
      ElMessage.error(result?.message || '申请失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    requestingSSL.value = false
  }
}

// ==================== Laravel 项目创建 ====================

// 选择 Laravel 项目目录
const selectLaravelDirectory = async () => {
  try {
    const path = await window.electronAPI?.selectDirectory()
    if (path) {
      laravelForm.targetDir = path
    }
  } catch (error: any) {
    ElMessage.error('选择目录失败: ' + error.message)
  }
}

// 自动生成域名
const autoGenerateDomain = () => {
  if (laravelForm.projectName) {
    // 将项目名转为小写，替换空格和下划线为连字符
    const safeName = laravelForm.projectName.toLowerCase().replace(/[\s_]+/g, '-')
    laravelForm.domain = `${safeName}.test`
  }
}

// 创建 Laravel 项目
const createLaravelProject = async () => {
  if (!laravelForm.projectName) {
    ElMessage.warning('请输入项目名称')
    return
  }
  if (!laravelForm.targetDir) {
    ElMessage.warning('请选择项目目录')
    return
  }
  if (!laravelForm.domain) {
    ElMessage.warning('请输入域名')
    return
  }
  if (!laravelForm.phpVersion) {
    ElMessage.warning('请选择 PHP 版本')
    return
  }
  
  creatingLaravel.value = true
  try {
    // 1. 创建 Laravel 项目
    const createResult = await window.electronAPI?.composer?.createLaravelProject(
      laravelForm.projectName,
      laravelForm.targetDir
    )
    
    if (!createResult?.success) {
      ElMessage.error(createResult?.message || '创建项目失败')
      return
    }
    
    // 2. 自动配置站点（Laravel 项目的 public 目录）
    const projectPath = createResult.projectPath
    const publicPath = `${projectPath}\\public`
    
    const siteData = {
      name: laravelForm.projectName,
      domain: laravelForm.domain,
      rootPath: publicPath,
      phpVersion: laravelForm.phpVersion,
      isLaravel: true,
      ssl: false,
      enabled: true
    }
    
    const siteResult = await window.electronAPI?.nginx.addSite(siteData)
    if (!siteResult?.success) {
      ElMessage.warning(`项目创建成功，但站点配置失败: ${siteResult?.message}`)
    }
    
    // 3. 添加到 hosts
    if (laravelForm.addToHosts) {
      await window.electronAPI?.hosts.add(laravelForm.domain, '127.0.0.1')
    }
    
    // 4. 重新加载 Nginx
    await window.electronAPI?.nginx.reload()
    
    ElMessage.success(`Laravel 项目 "${laravelForm.projectName}" 创建成功！`)
    showCreateLaravelDialog.value = false
    
    // 重置表单
    Object.assign(laravelForm, {
      projectName: '',
      targetDir: '',
      domain: '',
      phpVersion: phpVersions.value[0]?.version || '',
      addToHosts: true
    })
    
    // 刷新站点列表
    await loadData()
  } catch (error: any) {
    ElMessage.error('创建失败: ' + error.message)
  } finally {
    creatingLaravel.value = false
  }
}

onMounted(() => {
  loadData()
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

.sites-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
}

.site-card {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s;
  
  &:hover {
    border-color: var(--accent-light);
    box-shadow: var(--shadow-sm);
  }
  
  &.enabled {
    border-color: var(--success-color);
  }
  
  .site-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  
  .site-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--accent-gradient);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 24px;
    
    &.laravel {
      background: linear-gradient(135deg, #ff2d20 0%, #ff6b6b 100%);
    }
  }
  
  .site-main {
    flex: 1;
    
    .site-name {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    
    .site-domain {
      font-size: 13px;
      color: var(--accent-color);
      text-decoration: none;
      font-family: 'Fira Code', monospace;
      
      &:hover {
        text-decoration: underline;
      }
    }
  }
  
  .site-meta {
    margin-bottom: 12px;
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
      
      .el-icon {
        font-size: 14px;
      }
    }
  }
  
  .site-tags {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }
  
  .site-actions {
    display: flex;
    gap: 8px;
    border-top: 1px solid var(--border-light);
    padding-top: 16px;
  }
}

.form-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 12px;
}

.directory-input {
  display: flex;
  gap: 10px;
  width: 100%;
  
  .el-input {
    flex: 1;
  }
}

.header-actions {
  display: flex;
  gap: 10px;
}

.creating-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  margin-top: 16px;
  background: var(--bg-input);
  border-radius: 8px;
  color: var(--text-secondary);
  
  .is-loading {
    font-size: 20px;
    animation: spin 1s linear infinite;
    color: var(--accent-color);
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

