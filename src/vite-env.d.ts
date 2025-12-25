/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    openExternal: (url: string) => Promise<void>
    openPath: (path: string) => Promise<void>
    
    php: {
      getVersions: () => Promise<any[]>
      getAvailableVersions: () => Promise<any[]>
      install: (version: string) => Promise<{ success: boolean; message: string }>
      uninstall: (version: string) => Promise<{ success: boolean; message: string }>
      setActive: (version: string) => Promise<{ success: boolean; message: string }>
      getExtensions: (version: string) => Promise<any[]>
      enableExtension: (version: string, ext: string) => Promise<{ success: boolean; message: string }>
      disableExtension: (version: string, ext: string) => Promise<{ success: boolean; message: string }>
      installExtension: (version: string, ext: string) => Promise<{ success: boolean; message: string }>
      getConfig: (version: string) => Promise<string>
      saveConfig: (version: string, config: string) => Promise<{ success: boolean; message: string }>
    }
    
    mysql: {
      getVersions: () => Promise<any[]>
      getAvailableVersions: () => Promise<any[]>
      install: (version: string) => Promise<{ success: boolean; message: string }>
      uninstall: (version: string) => Promise<{ success: boolean; message: string }>
      start: (version: string) => Promise<{ success: boolean; message: string }>
      stop: (version: string) => Promise<{ success: boolean; message: string }>
      restart: (version: string) => Promise<{ success: boolean; message: string }>
      getStatus: (version: string) => Promise<any>
      changePassword: (version: string, newPassword: string) => Promise<{ success: boolean; message: string }>
      getConfig: (version: string) => Promise<string>
      saveConfig: (version: string, config: string) => Promise<{ success: boolean; message: string }>
    }
    
    nginx: {
      getVersions: () => Promise<any[]>
      getAvailableVersions: () => Promise<any[]>
      install: (version: string) => Promise<{ success: boolean; message: string }>
      uninstall: (version: string) => Promise<{ success: boolean; message: string }>
      start: () => Promise<{ success: boolean; message: string }>
      stop: () => Promise<{ success: boolean; message: string }>
      restart: () => Promise<{ success: boolean; message: string }>
      reload: () => Promise<{ success: boolean; message: string }>
      getStatus: () => Promise<any>
      getConfig: () => Promise<string>
      saveConfig: (config: string) => Promise<{ success: boolean; message: string }>
      getSites: () => Promise<any[]>
      addSite: (site: any) => Promise<{ success: boolean; message: string }>
      removeSite: (name: string) => Promise<{ success: boolean; message: string }>
      enableSite: (name: string) => Promise<{ success: boolean; message: string }>
      disableSite: (name: string) => Promise<{ success: boolean; message: string }>
      generateLaravelConfig: (site: any) => Promise<string>
      requestSSL: (domain: string, email: string) => Promise<{ success: boolean; message: string }>
    }
    
    redis: {
      getVersions: () => Promise<any[]>
      getAvailableVersions: () => Promise<any[]>
      install: (version: string) => Promise<{ success: boolean; message: string }>
      uninstall: (version: string) => Promise<{ success: boolean; message: string }>
      start: () => Promise<{ success: boolean; message: string }>
      stop: () => Promise<{ success: boolean; message: string }>
      restart: () => Promise<{ success: boolean; message: string }>
      getStatus: () => Promise<any>
      getConfig: () => Promise<string>
      saveConfig: (config: string) => Promise<{ success: boolean; message: string }>
    }
    
    node: {
      getVersions: () => Promise<any[]>
      getAvailableVersions: () => Promise<any[]>
      install: (version: string, downloadUrl: string) => Promise<{ success: boolean; message: string }>
      uninstall: (version: string) => Promise<{ success: boolean; message: string }>
      setActive: (version: string) => Promise<{ success: boolean; message: string }>
      getInfo: (version: string) => Promise<any>
    }
    
    service: {
      getAll: () => Promise<any[]>
      setAutoStart: (service: string, enabled: boolean) => Promise<{ success: boolean; message: string }>
      getAutoStart: (service: string) => Promise<boolean>
      startAll: () => Promise<{ success: boolean; message: string; details: string[] }>
      stopAll: () => Promise<{ success: boolean; message: string; details: string[] }>
    }
    
    hosts: {
      get: () => Promise<any[]>
      add: (domain: string, ip: string) => Promise<{ success: boolean; message: string }>
      remove: (domain: string) => Promise<{ success: boolean; message: string }>
    }
    
    config: {
      get: (key: string) => Promise<any>
      set: (key: string, value: any) => Promise<void>
      getBasePath: () => Promise<string>
      setBasePath: (path: string) => Promise<void>
    }
  }
}

