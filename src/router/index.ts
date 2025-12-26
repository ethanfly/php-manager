import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { title: '仪表盘' }
    },
    {
      path: '/php',
      name: 'php',
      component: () => import('@/views/PhpManager.vue'),
      meta: { title: 'PHP 管理' }
    },
    {
      path: '/mysql',
      name: 'mysql',
      component: () => import('@/views/MysqlManager.vue'),
      meta: { title: 'MySQL 管理' }
    },
    {
      path: '/nginx',
      name: 'nginx',
      component: () => import('@/views/NginxManager.vue'),
      meta: { title: 'Nginx 管理' }
    },
    {
      path: '/redis',
      name: 'redis',
      component: () => import('@/views/RedisManager.vue'),
      meta: { title: 'Redis 管理' }
    },
    {
      path: '/nodejs',
      name: 'nodejs',
      component: () => import('@/views/NodeManager.vue'),
      meta: { title: 'Node.js 管理' }
    },
    {
      path: '/sites',
      name: 'sites',
      component: () => import('@/views/SitesManager.vue'),
      meta: { title: '站点管理' }
    },
    {
      path: '/hosts',
      name: 'hosts',
      component: () => import('@/views/HostsManager.vue'),
      meta: { title: 'Hosts 管理' }
    },
    {
      path: '/git',
      name: 'git',
      component: () => import('@/views/GitManager.vue'),
      meta: { title: 'Git 管理' }
    },
    {
      path: '/python',
      name: 'python',
      component: () => import('@/views/PythonManager.vue'),
      meta: { title: 'Python 管理' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { title: '设置' }
    }
  ]
})

export default router

