<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">
        <span class="title-icon"><el-icon><Tools /></el-icon></span>
        Rust 管理
      </h1>
      <p class="page-description">
        通过 rustup 管理 Rust toolchain，支持安装 / 切换 / 卸载
      </p>
    </div>

    <!-- rustup 状态提示 -->
    <el-alert
      v-if="rustupStatus !== null"
      :type="rustupStatus.installed ? 'success' : 'warning'"
      :closable="false"
      class="mb-4">
      <template #title>
        <span v-if="rustupStatus.installed">
          rustup {{ rustupStatus.version }}
          <span v-if="rustupStatus.rustcVersion">
            · rustc {{ rustupStatus.rustcVersion }}
          </span>
        </span>
        <span v-else>
          未检测到 rustup。Rust 管理依赖 rustup，请先安装
          <a href="https://rustup.rs" target="_blank">rustup.rs</a>
          或用 mise 安装：mise use -g rust@stable
        </span>
      </template>
    </el-alert>

    <!-- 已安装 toolchain -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">已安装 toolchain</span>
        <div class="header-actions">
          <el-button @click="updateAll" :loading="updating">
            <el-icon><Refresh /></el-icon>
            更新全部
          </el-button>
          <el-button type="primary" @click="showInstallDialog = true">
            <el-icon><Plus /></el-icon>
            安装新版本
          </el-button>
        </div>
      </div>
      <div class="card-content">
        <div v-if="loading" class="loading-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <el-empty v-else-if="versions.length === 0" description="未检测到已安装的 Rust toolchain" />
        <div v-else class="version-grid">
          <div
            v-for="v in versions"
            :key="v.version"
            class="version-card"
            :class="{ active: v.isActive }">
            <div class="version-main">
              <div class="version-icon">
                <el-icon><Tools /></el-icon>
              </div>
              <div class="version-content">
                <div class="version-title">
                  <span class="version-number">{{ v.label }}</span>
                  <el-tag v-if="v.isActive" type="success" size="small" effect="dark">默认</el-tag>
                  <el-tag
                    v-if="v.source === 'system'"
                    type="warning"
                    size="small"
                    effect="plain"
                    class="ml-2"
                    >系统安装</el-tag
                  >
                </div>
                <div class="version-meta">
                  <span class="version-path">{{ v.path || v.version }}</span>
                </div>
              </div>
            </div>
            <div class="version-actions">
              <el-button
                v-if="!v.isActive && v.source === 'rustup'"
                type="primary"
                size="small"
                @click="setActive(v)"
                :loading="settingActive === v.version">
                设为默认
              </el-button>
              <el-button
                v-if="v.source === 'rustup' && !v.isActive"
                type="danger"
                size="small"
                plain
                @click="uninstall(v)"
                :loading="uninstalling === v.version">
                卸载
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装新版本对话框 -->
    <el-dialog v-model="showInstallDialog" title="安装 Rust toolchain" width="640px">
      <el-alert type="info" :closable="false" class="mb-4">
        <template #title>
          <el-icon><InfoFilled /></el-icon>
          安装方式
        </template>
        通过 rustup 安装。stable/beta/nightly 为 channel（持续更新到最新），
        下方列表为具体历史点版本。安装可能需要较长时间。
      </el-alert>
      <div v-if="loadingAvailableVersions" class="loading-state">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>正在获取版本列表...</span>
      </div>
      <div v-else class="available-versions">
        <el-table :data="availableVersions" style="width: 100%" max-height="420">
          <el-table-column prop="label" label="版本" min-width="200" />
          <el-table-column label="类型" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.type === 'channel'" type="success" size="small"
                >channel</el-tag
              >
              <el-tag v-else type="info" size="small">点版本</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="{ row }">
              <el-button
                type="primary"
                size="small"
                @click="installVersion(row)"
                :loading="installing === row.name">
                安装
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="showInstallDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted } from 'vue'
  import { ElMessage, ElMessageBox } from 'element-plus'
  import { Tools, Refresh, Plus, InfoFilled, Loading } from '@element-plus/icons-vue'

  defineOptions({
    name: 'RustManager',
  })

  interface RustVersion {
    version: string
    label: string
    path: string
    isActive: boolean
    source: 'rustup' | 'system'
  }

  interface AvailableRustVersion {
    name: string
    label: string
    type: 'channel' | 'version'
    date?: string
  }

  const versions = ref<RustVersion[]>([])
  const availableVersions = ref<AvailableRustVersion[]>([])
  const loading = ref(false)
  const loadingAvailableVersions = ref(false)
  const showInstallDialog = ref(false)
  const installing = ref('')
  const uninstalling = ref('')
  const settingActive = ref('')
  const updating = ref(false)
  const rustupStatus = ref<{
    installed: boolean
    version?: string
    rustcVersion?: string
  } | null>(null)

  const loadVersions = async () => {
    loading.value = true
    try {
      versions.value = (await window.electronAPI?.rust.getVersions()) || []
    } catch (e: any) {
      console.error('加载版本失败:', e)
    } finally {
      loading.value = false
    }
  }

  const loadAvailableVersions = async () => {
    loadingAvailableVersions.value = true
    try {
      availableVersions.value =
        (await window.electronAPI?.rust.getAvailableVersions()) || []
    } catch (e: any) {
      console.error('加载可用版本失败:', e)
    } finally {
      loadingAvailableVersions.value = false
    }
  }

  const checkSystem = async () => {
    try {
      rustupStatus.value = await window.electronAPI?.rust.checkSystem()
    } catch {}
  }

  const installVersion = async (row: AvailableRustVersion) => {
    installing.value = row.name
    try {
      const result = await window.electronAPI?.rust.install(row.name)
      if (result?.success) {
        ElMessage.success(result.message)
        await loadVersions()
      } else {
        ElMessage.error(result?.message || '安装失败')
      }
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      installing.value = ''
    }
  }

  const uninstall = async (v: RustVersion) => {
    try {
      await ElMessageBox.confirm(
        `确定要卸载 Rust toolchain ${v.label} 吗？此操作不可恢复。`,
        '确认卸载',
        { type: 'warning' }
      )
      uninstalling.value = v.version
      const result = await window.electronAPI?.rust.uninstall(v.version)
      if (result?.success) {
        ElMessage.success(result.message)
        await loadVersions()
      } else {
        ElMessage.error(result?.message || '卸载失败')
      }
    } catch (e: any) {
      if (e !== 'cancel') ElMessage.error(e.message)
    } finally {
      uninstalling.value = ''
    }
  }

  const setActive = async (v: RustVersion) => {
    settingActive.value = v.version
    try {
      const result = await window.electronAPI?.rust.setActive(v.version)
      if (result?.success) {
        ElMessage.success(result.message)
        await loadVersions()
      } else {
        ElMessage.error(result?.message || '设置失败')
      }
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      settingActive.value = ''
    }
  }

  const updateAll = async () => {
    updating.value = true
    try {
      const result = await window.electronAPI?.rust.update()
      if (result?.success) {
        ElMessage.success('更新完成')
        await loadVersions()
        await checkSystem()
      } else {
        ElMessage.error(result?.message || '更新失败')
      }
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      updating.value = false
    }
  }

  onMounted(() => {
    loadVersions()
    loadAvailableVersions()
    checkSystem()
  })
</script>

<style lang="scss" scoped>
  .version-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }

  .version-card {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 24px;
    transition: all 0.3s;
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
    overflow: hidden;

    &:hover {
      border-color: var(--accent-color);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      transform: translateY(-2px);
    }

    &.active {
      border-color: var(--accent-border);
      background: var(--accent-bg);
    }

    .version-main {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .version-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      background: var(--accent-bg);
      border: 1px solid var(--accent-border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-color);
      flex-shrink: 0;
      font-size: 20px;
    }

    .version-content {
      flex: 1;
      min-width: 0;
    }

    .version-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .version-number {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.5px;
    }

    .version-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .version-path {
      font-size: 12px;
      color: var(--text-muted);
      font-family: 'Fira Code', 'Consolas', monospace;
      word-break: break-all;
      overflow-wrap: anywhere;
      line-height: 1.4;
    }

    .version-actions {
      display: flex;
      gap: 10px;
      padding-top: 4px;
      border-top: 1px solid var(--border-color);

      .el-button {
        flex: 1;
      }
    }
  }

  .available-versions {
    .el-table {
      --el-table-bg-color: transparent;
      --el-table-tr-bg-color: transparent;
      --el-table-header-bg-color: var(--bg-input);
    }
  }

  .header-actions {
    display: flex;
    gap: 10px;
  }

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
    to {
      transform: rotate(360deg);
    }
  }

  .mb-4 {
    margin-bottom: 16px;

    a {
      color: var(--accent-color);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
</style>
