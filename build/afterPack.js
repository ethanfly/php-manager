const path = require('path');
const fs = require('fs');

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
  
  if (!fs.existsSync(exePath)) {
    console.warn(`Exe not found: ${exePath}`);
    return;
  }
  
  if (!fs.existsSync(iconPath)) {
    console.warn(`Icon not found: ${iconPath}`);
    return;
  }
  
  try {
    // 使用 npm 安装的 rcedit 模块
    const { rcedit } = require('rcedit');
    
    console.log(`Setting icon for: ${exePath}`);
    console.log(`Using icon: ${iconPath}`);
    
    await rcedit(exePath, {
      icon: iconPath
    });
    
    console.log('Icon set successfully!');
  } catch (error) {
    console.error('Failed to set icon:', error.message);
  }
};
