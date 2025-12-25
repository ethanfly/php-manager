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
        <el-button type="primary" @click="showAddSiteDialog = true">
          <el-icon><Plus /></el-icon>
          添加站点
        </el-button>
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
              <span class="meta-item">
                <el-icon><Folder /></el-icon>
                {{ site.rootPath }}
              </span>
              <span class="meta-item">
                <el-icon><Files /></el-icon>
                PHP {{ site.phpVersion }}
              </span>
            </div>
            <div class="site-tags">
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
        <el-form-item label="根目录" required>
          <div class="directory-input">
            <el-input v-model="siteForm.rootPath" placeholder="点击右侧按钮选择目录" readonly />
            <el-button type="primary" @click="selectDirectory" :icon="FolderOpened">
              选择目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="PHP 版本" required>
          <el-select v-model="siteForm.phpVersion" placeholder="选择 PHP 版本">
            <el-option 
              v-for="v in phpVersions" 
              :key="v.version" 
              :label="'PHP ' + v.version" 
              :value="v.version" 
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Laravel 项目">
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
        <el-form-item label="根目录" required>
          <div class="directory-input">
            <el-input v-model="editForm.rootPath" placeholder="点击右侧按钮选择目录" readonly />
            <el-button type="primary" @click="selectEditDirectory" :icon="FolderOpened">
              选择目录
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="PHP 版本" required>
          <el-select v-model="editForm.phpVersion" placeholder="选择 PHP 版本">
            <el-option 
              v-for="v in phpVersions" 
              :key="v.version" 
              :label="'PHP ' + v.version" 
              :value="v.version" 
            />
          </el-select>
        </el-form-item>
        <el-form-item label="Laravel 项目">
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOpened } from '@element-plus/icons-vue'

interface SiteConfig {
  name: string
  domain: string
  rootPath: string
  phpVersion: string
  isLaravel: boolean
  ssl: boolean
  enabled: boolean
}

const loading = ref(false)
const sites = ref<SiteConfig[]>([])
const phpVersions = ref<any[]>([])
const showAddSiteDialog = ref(false)
const adding = ref(false)
const addToHosts = ref(true)

const siteForm = reactive<SiteConfig>({
  name: '',
  domain: '',
  rootPath: '',
  phpVersion: '',
  isLaravel: false,
  ssl: false,
  enabled: true
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
  enabled: true
})

const loadData = async () => {
  try {
    sites.value = await window.electronAPI?.nginx.getSites() || []
    phpVersions.value = await window.electronAPI?.php.getVersions() || []
    
    // 默认选择第一个 PHP 版本
    if (phpVersions.value.length > 0 && !siteForm.phpVersion) {
      siteForm.phpVersion = phpVersions.value[0].version
    }
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
  
  if (!siteForm.domain || !siteForm.rootPath || !siteForm.phpVersion) {
    ElMessage.warning('请填写所有必填字段（域名、根目录、PHP版本）')
    return
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
      enabled: siteForm.enabled
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
        enabled: true
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
    enabled: site.enabled
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
  if (!editForm.domain || !editForm.rootPath || !editForm.phpVersion) {
    ElMessage.warning('请填写所有必填字段')
    return
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
      enabled: editForm.enabled
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
</style>

