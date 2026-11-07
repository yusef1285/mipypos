; Permite que los teléfonos de la red local (Wi-Fi privada) lleguen al servidor de MipyPOS.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MipyPOS servidor local"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MipyPOS servidor local" dir=in action=allow protocol=TCP localport=8787 profile=private,domain program="$INSTDIR\MipyPOS.exe"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MipyPOS descubrimiento"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MipyPOS descubrimiento" dir=in action=allow protocol=UDP localport=5353 profile=private,domain program="$INSTDIR\MipyPOS.exe"'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MipyPOS servidor local"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MipyPOS descubrimiento"'
!macroend
