/**
 * 自动更新版本号脚本
 * 每次打包时自动增加 patch 版本号
 * 
 * 用法:
 *   node scripts/bump-version.js        # patch: 1.0.0 -> 1.0.1
 *   node scripts/bump-version.js minor  # minor: 1.0.0 -> 1.1.0
 *   node scripts/bump-version.js major  # major: 1.0.0 -> 2.0.0
 */

const fs = require('fs')
const path = require('path')

const packagePath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))

const currentVersion = pkg.version
const [major, minor, patch] = currentVersion.split('.').map(Number)

// 获取命令行参数
const bumpType = process.argv[2] || 'patch'

let newVersion
switch (bumpType) {
    case 'major':
        newVersion = `${major + 1}.0.0`
        break
    case 'minor':
        newVersion = `${major}.${minor + 1}.0`
        break
    case 'patch':
    default:
        newVersion = `${major}.${minor}.${patch + 1}`
        break
}

// 更新 package.json
pkg.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')

// 生成构建时间戳
const buildTime = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

console.log(`✅ 版本号已更新: ${currentVersion} -> ${newVersion}`)
console.log(`📦 构建时间: ${buildTime}`)

// 将版本信息写入一个文件，供应用读取
const versionInfo = {
    version: newVersion,
    buildTime: new Date().toISOString(),
    buildDate: new Date().toLocaleDateString('zh-CN')
}

const versionFilePath = path.join(__dirname, '..', 'public', 'version.json')
fs.writeFileSync(versionFilePath, JSON.stringify(versionInfo, null, 2))

console.log(`📄 版本信息已写入: public/version.json`)

