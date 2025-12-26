import { contextBridge, ipcRenderer } from 'electron'

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  
  // Dialog
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // 下载进度监听
  onDownloadProgress: (callback: (data: { type: string; progress: number; downloaded: number; total: number }) => void) => {
    ipcRenderer.on('download-progress', (_, data) => callback(data))
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress')
  },

  // PHP 管理
  php: {
    getVersions: () => ipcRenderer.invoke('php:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('php:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('php:install', version),
    uninstall: (version: string) => ipcRenderer.invoke('php:uninstall', version),
    setActive: (version: string) => ipcRenderer.invoke('php:setActive', version),
    getExtensions: (version: string) => ipcRenderer.invoke('php:getExtensions', version),
    openExtensionDir: (version: string) => ipcRenderer.invoke('php:openExtensionDir', version),
    getAvailableExtensions: (version: string, searchKeyword?: string) => ipcRenderer.invoke('php:getAvailableExtensions', version, searchKeyword),
    enableExtension: (version: string, ext: string) => ipcRenderer.invoke('php:enableExtension', version, ext),
    disableExtension: (version: string, ext: string) => ipcRenderer.invoke('php:disableExtension', version, ext),
    installExtension: (version: string, ext: string, downloadUrl?: string, packageName?: string) => ipcRenderer.invoke('php:installExtension', version, ext, downloadUrl, packageName),
    getConfig: (version: string) => ipcRenderer.invoke('php:getConfig', version),
    saveConfig: (version: string, config: string) => ipcRenderer.invoke('php:saveConfig', version, config)
  },

  // Composer 管理
  composer: {
    getStatus: () => ipcRenderer.invoke('composer:getStatus'),
    install: () => ipcRenderer.invoke('composer:install'),
    uninstall: () => ipcRenderer.invoke('composer:uninstall'),
    setMirror: (mirror: string) => ipcRenderer.invoke('composer:setMirror', mirror),
    createLaravelProject: (projectName: string, targetDir: string) => ipcRenderer.invoke('composer:createLaravelProject', projectName, targetDir)
  },

  // MySQL 管理
  mysql: {
    getVersions: () => ipcRenderer.invoke('mysql:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('mysql:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('mysql:install', version),
    uninstall: (version: string) => ipcRenderer.invoke('mysql:uninstall', version),
    start: (version: string) => ipcRenderer.invoke('mysql:start', version),
    stop: (version: string) => ipcRenderer.invoke('mysql:stop', version),
    restart: (version: string) => ipcRenderer.invoke('mysql:restart', version),
    getStatus: (version: string) => ipcRenderer.invoke('mysql:getStatus', version),
    changePassword: (version: string, newPassword: string, currentPassword?: string) => ipcRenderer.invoke('mysql:changePassword', version, newPassword, currentPassword),
    getConfig: (version: string) => ipcRenderer.invoke('mysql:getConfig', version),
    saveConfig: (version: string, config: string) => ipcRenderer.invoke('mysql:saveConfig', version, config)
  },

  // Nginx 管理
  nginx: {
    getVersions: () => ipcRenderer.invoke('nginx:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('nginx:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('nginx:install', version),
    uninstall: (version: string) => ipcRenderer.invoke('nginx:uninstall', version),
    start: () => ipcRenderer.invoke('nginx:start'),
    stop: () => ipcRenderer.invoke('nginx:stop'),
    restart: () => ipcRenderer.invoke('nginx:restart'),
    reload: () => ipcRenderer.invoke('nginx:reload'),
    getStatus: () => ipcRenderer.invoke('nginx:getStatus'),
    getConfig: () => ipcRenderer.invoke('nginx:getConfig'),
    saveConfig: (config: string) => ipcRenderer.invoke('nginx:saveConfig', config),
    getSites: () => ipcRenderer.invoke('nginx:getSites'),
    addSite: (site: any) => ipcRenderer.invoke('nginx:addSite', site),
    removeSite: (name: string) => ipcRenderer.invoke('nginx:removeSite', name),
    updateSite: (originalName: string, site: any) => ipcRenderer.invoke('nginx:updateSite', originalName, site),
    enableSite: (name: string) => ipcRenderer.invoke('nginx:enableSite', name),
    disableSite: (name: string) => ipcRenderer.invoke('nginx:disableSite', name),
    generateLaravelConfig: (site: any) => ipcRenderer.invoke('nginx:generateLaravelConfig', site),
    requestSSL: (domain: string, email: string) => ipcRenderer.invoke('nginx:requestSSL', domain, email)
  },

  // Redis 管理
  redis: {
    getVersions: () => ipcRenderer.invoke('redis:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('redis:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('redis:install', version),
    uninstall: (version: string) => ipcRenderer.invoke('redis:uninstall', version),
    start: () => ipcRenderer.invoke('redis:start'),
    stop: () => ipcRenderer.invoke('redis:stop'),
    restart: () => ipcRenderer.invoke('redis:restart'),
    getStatus: () => ipcRenderer.invoke('redis:getStatus'),
    getConfig: () => ipcRenderer.invoke('redis:getConfig'),
    saveConfig: (config: string) => ipcRenderer.invoke('redis:saveConfig', config)
  },

  // Node.js 管理
  node: {
    getVersions: () => ipcRenderer.invoke('node:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('node:getAvailableVersions'),
    install: (version: string, downloadUrl: string) => ipcRenderer.invoke('node:install', version, downloadUrl),
    uninstall: (version: string) => ipcRenderer.invoke('node:uninstall', version),
    setActive: (version: string) => ipcRenderer.invoke('node:setActive', version),
    getInfo: (version: string) => ipcRenderer.invoke('node:getInfo', version)
  },

  // Git 管理
  git: {
    getVersions: () => ipcRenderer.invoke('git:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('git:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('git:install', version),
    uninstall: () => ipcRenderer.invoke('git:uninstall'),
    checkSystem: () => ipcRenderer.invoke('git:checkSystem'),
    getConfig: () => ipcRenderer.invoke('git:getConfig'),
    setConfig: (name: string, email: string) => ipcRenderer.invoke('git:setConfig', name, email)
  },

  // Python 管理
  python: {
    getVersions: () => ipcRenderer.invoke('python:getVersions'),
    getAvailableVersions: () => ipcRenderer.invoke('python:getAvailableVersions'),
    install: (version: string) => ipcRenderer.invoke('python:install', version),
    uninstall: (version: string) => ipcRenderer.invoke('python:uninstall', version),
    setActive: (version: string) => ipcRenderer.invoke('python:setActive', version),
    checkSystem: () => ipcRenderer.invoke('python:checkSystem'),
    getPipInfo: (version: string) => ipcRenderer.invoke('python:getPipInfo', version),
    installPackage: (version: string, packageName: string) => ipcRenderer.invoke('python:installPackage', version, packageName)
  },

  // 服务管理
  service: {
    getAll: () => ipcRenderer.invoke('service:getAll'),
    setAutoStart: (service: string, enabled: boolean) => ipcRenderer.invoke('service:setAutoStart', service, enabled),
    getAutoStart: (service: string) => ipcRenderer.invoke('service:getAutoStart', service),
    startAll: () => ipcRenderer.invoke('service:startAll'),
    stopAll: () => ipcRenderer.invoke('service:stopAll'),
    // PHP-CGI 多版本管理
    getPhpCgiStatus: () => ipcRenderer.invoke('service:getPhpCgiStatus'),
    startPhpCgi: () => ipcRenderer.invoke('service:startPhpCgi'),
    stopPhpCgi: () => ipcRenderer.invoke('service:stopPhpCgi'),
    startAllPhpCgi: () => ipcRenderer.invoke('service:startAllPhpCgi'),
    stopAllPhpCgi: () => ipcRenderer.invoke('service:stopAllPhpCgi'),
    startPhpCgiVersion: (version: string) => ipcRenderer.invoke('service:startPhpCgiVersion', version),
    stopPhpCgiVersion: (version: string) => ipcRenderer.invoke('service:stopPhpCgiVersion', version),
    getPhpCgiPort: (version: string) => ipcRenderer.invoke('service:getPhpCgiPort', version)
  },

  // Hosts 管理
  hosts: {
    get: () => ipcRenderer.invoke('hosts:get'),
    add: (domain: string, ip: string) => ipcRenderer.invoke('hosts:add', domain, ip),
    remove: (domain: string) => ipcRenderer.invoke('hosts:remove', domain)
  },

  // 配置管理
  config: {
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
    getBasePath: () => ipcRenderer.invoke('config:getBasePath'),
    setBasePath: (path: string) => ipcRenderer.invoke('config:setBasePath', path)
  },

  // 日志管理
  log: {
    getFiles: () => ipcRenderer.invoke('log:getFiles'),
    read: (logPath: string, lines?: number) => ipcRenderer.invoke('log:read', logPath, lines),
    clear: (logPath: string) => ipcRenderer.invoke('log:clear', logPath),
    getDirectory: (type: 'nginx' | 'php' | 'mysql' | 'sites', version?: string) => 
      ipcRenderer.invoke('log:getDirectory', type, version)
  },

  // 应用设置
  app: {
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('app:setAutoLaunch', enabled),
    getAutoLaunch: () => ipcRenderer.invoke('app:getAutoLaunch'),
    setStartMinimized: (enabled: boolean) => ipcRenderer.invoke('app:setStartMinimized', enabled),
    getStartMinimized: () => ipcRenderer.invoke('app:getStartMinimized'),
    getVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<{ version: string; buildTime: string; buildDate: string; isPackaged: boolean }>,
    setAutoStartServices: (enabled: boolean) => ipcRenderer.invoke('app:setAutoStartServices', enabled),
    getAutoStartServices: () => ipcRenderer.invoke('app:getAutoStartServices'),
    quit: () => ipcRenderer.invoke('app:quit')
  },

  // 监听服务状态变化
  onServiceStatusChanged: (callback: () => void) => {
    ipcRenderer.on('service-status-changed', callback)
  },
  removeServiceStatusChangedListener: (callback: () => void) => {
    ipcRenderer.removeListener('service-status-changed', callback)
  }
})

// 声明 Window 接口扩展
declare global {
  interface Window {
    electronAPI: typeof api
  }
}

const api = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  php: {} as any,
  mysql: {} as any,
  nginx: {} as any,
  redis: {} as any,
  service: {} as any,
  hosts: {} as any,
  config: {} as any
}

