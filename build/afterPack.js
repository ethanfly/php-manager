const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // 只在 Windows 上执行
  if (process.platform !== 'win32') {
    return;
  }

  console.log('Running afterPack hook to set icon and version info...');
  
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productName;
  const version = context.packager.appInfo.version;
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
    // rcedit 是默认导出
    const rcedit = require('rcedit');
    
    console.log(`Setting icon and version info for: ${exePath}`);
    console.log(`Using icon: ${iconPath}`);
    
    await rcedit(exePath, {
      icon: iconPath,
      'version-string': {
        'ProductName': productName,
        'FileDescription': productName,
        'CompanyName': 'PHPer',
        'LegalCopyright': 'Copyright © 2024 PHPer',
        'OriginalFilename': `${productName}.exe`,
        'InternalName': productName
      },
      'file-version': version,
      'product-version': version
    });
    
    console.log('Icon and version info set successfully!');
  } catch (error) {
    console.error('Failed to set icon:', error.message);
    // 不阻止打包继续
  }
};
