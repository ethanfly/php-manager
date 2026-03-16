!macro customInit
  ; 设置默认安装目录为 D 盘
  StrCpy $INSTDIR "D:\PHPer"
!macroend

!macro customInstall
  ; 安装完成后的自定义操作
  ; 删除默认创建的桌面快捷方式，然后重新创建带正确图标的快捷方式
  Delete "$DESKTOP\PHPer开发环境管理器.lnk"
  CreateShortCut "$DESKTOP\PHPer开发环境管理器.lnk" "$INSTDIR\PHPer开发环境管理器.exe" "" "$INSTDIR\PHPer开发环境管理器.exe" 0
!macroend

!macro customUnInstall
  ; 卸载时的自定义操作
  Delete "$DESKTOP\PHPer开发环境管理器.lnk"

  ; 清理开机自启计划任务
  nsExec::ExecToLog 'schtasks /delete /tn "PHPerDevManager" /f'

  ; 删除 VBS 静默启动脚本
  Delete "$INSTDIR\silent_start.vbs"

  ; 删除 Startup 目录下的服务自启脚本
  Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\phper-*.bat"
!macroend

