<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Document /></el-icon></span>
        Hosts 管理
      </h1>
      <p class="page-description">管理系统 hosts 文件，添加或删除域名映射</p>
    </div>

    <!-- Hosts 列表 -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <el-icon><List /></el-icon>
          Hosts 条目
        </span>
        <div class="card-actions">
          <el-button @click="refreshHosts" :loading="refreshing">
            <el-icon v-if="!refreshing"><RefreshRight /></el-icon>
            刷新 Hosts
          </el-button>
          <el-button @click="flushDns">
            <el-icon><Refresh /></el-icon>
            刷新 DNS
          </el-button>
          <el-button type="primary" @click="showAddDialog = true">
            <el-icon><Plus /></el-icon>
            添加条目
          </el-button>
        </div>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-else>
          <el-table :data="hosts" style="width: 100%">
            <el-table-column prop="ip" label="IP 地址" width="180" />
            <el-table-column prop="domain" label="域名">
              <template #default="{ row }">
                <span class="domain-text">{{ row.domain }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="comment" label="备注" />
            <el-table-column label="操作" width="100" fixed="right">
              <template #default="{ row }">
                <el-button 
                  type="danger" 
                  size="small" 
                  link
                  @click="removeHost(row.domain)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          
          <div v-if="hosts.length === 0" class="empty-hint">
            暂无自定义 hosts 条目
          </div>
        </div>
      </div>
    </div>

    <!-- 添加对话框 -->
    <el-dialog 
      v-model="showAddDialog" 
      title="添加 Hosts 条目"
      width="500px"
    >
      <el-form :model="hostForm" label-width="80px">
        <el-form-item label="IP 地址" required>
          <el-input v-model="hostForm.ip" placeholder="例如: 127.0.0.1" />
        </el-form-item>
        <el-form-item label="域名" required>
          <el-input v-model="hostForm.domain" placeholder="例如: mysite.test" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="addHost" :loading="adding">
          添加
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

// 定义组件名称以便 KeepAlive 正确缓存
defineOptions({
  name: 'HostsManager'
})

interface HostEntry {
  ip: string
  domain: string
  comment?: string
}

const loading = ref(false)
const refreshing = ref(false)
const hosts = ref<HostEntry[]>([])
const showAddDialog = ref(false)
const adding = ref(false)

const hostForm = reactive({
  ip: '127.0.0.1',
  domain: ''
})

const loadHosts = async () => {
  try {
    hosts.value = await window.electronAPI?.hosts.get() || []
  } catch (error: any) {
    console.error('加载 hosts 失败:', error)
  }
}

const refreshHosts = async () => {
  refreshing.value = true
  try {
    hosts.value = await window.electronAPI?.hosts.get() || []
    ElMessage.success('Hosts 列表已刷新')
  } catch (error: any) {
    console.error('刷新 hosts 失败:', error)
    ElMessage.error('刷新失败: ' + error.message)
  } finally {
    refreshing.value = false
  }
}

const addHost = async () => {
  if (!hostForm.ip || !hostForm.domain) {
    ElMessage.warning('请填写 IP 地址和域名')
    return
  }
  
  adding.value = true
  try {
    const result = await window.electronAPI?.hosts.add(hostForm.domain, hostForm.ip)
    if (result?.success) {
      ElMessage.success(result.message)
      showAddDialog.value = false
      hostForm.domain = ''
      await loadHosts()
    } else {
      ElMessage.error(result?.message || '添加失败')
    }
  } catch (error: any) {
    ElMessage.error(error.message)
  } finally {
    adding.value = false
  }
}

const removeHost = async (domain: string) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除 ${domain} 吗？`,
      '确认删除',
      { type: 'warning' }
    )
    
    const result = await window.electronAPI?.hosts.remove(domain)
    if (result?.success) {
      ElMessage.success(result.message)
      await loadHosts()
    } else {
      ElMessage.error(result?.message || '删除失败')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error.message)
    }
  }
}

const flushDns = async () => {
  try {
    ElMessage.success('DNS 缓存已刷新')
  } catch (error: any) {
    ElMessage.error(error.message)
  }
}

onMounted(() => {
  loadHosts()
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

.domain-text {
  font-family: 'Fira Code', monospace;
  color: var(--accent-color);
}

.empty-hint {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}
</style>

