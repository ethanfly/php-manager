const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

exports.default = async function(context) {
  // 只在 Windows 上执行
  if (process.platform !== 'win32') {
    return;
  }

  console.log('Running afterPack hook to set icon...');
  
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productName;
  const exePath = path.join(appOutDir, `${productName}.exe`);
  const iconPath = path.join(__dirname, 'icon.ico');
  
  // rcedit 路径
  const userHome = os.homedir();
  const cacheDir = path.join(userHome, 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  
  // 查找 rcedit
  let rceditPath = null;
  if (fs.existsSync(cacheDir)) {
    const dirs = fs.readdirSync(cacheDir);
    for (const dir of dirs) {
      const possiblePath = path.join(cacheDir, dir, 'rcedit-x64.exe');
      if (fs.existsSync(possiblePath)) {
        rceditPath = possiblePath;
        break;
      }
    }
  }
  
  if (!rceditPath) {
    console.warn('rcedit not found, skipping icon modification');
    return;
  }
  
  if (!fs.existsSync(exePath)) {
    console.warn(`Exe not found: ${exePath}`);
    return;
  }
  
  if (!fs.existsSync(iconPath)) {
    console.warn(`Icon not found: ${iconPath}`);
    return;
  }
  
  try {
    console.log(`Setting icon for: ${exePath}`);
    console.log(`Using icon: ${iconPath}`);
    console.log(`Using rcedit: ${rceditPath}`);
    
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
      stdio: 'inherit'
    });
    
    console.log('Icon set successfully!');
  } catch (error) {
    console.error('Failed to set icon:', error.message);
  }
};

