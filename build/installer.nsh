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
!macroend

