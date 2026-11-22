' Starts the Ollama AI server hidden (no window, no tray icon) for the glucose dashboard on the Raspberry Pi.
' Put a copy in your Startup folder (Win+R, type shell:startup, Enter) to start it when you log in to Windows.
' The dashboard loads the model when you open it and releases it when you close it. Delete the copy to stop it.
'
' Ollama has no password of its own. It listens on every network card here (0.0.0.0) so that the Pi can reach it, and the
' Windows firewall decides who gets in: only the Pi's address, and only on networks marked Private (see pi/README.md).
' On a laptop that joins other Wi-Fi networks, those are Public, so nobody there reaches Ollama.
Set sh = CreateObject("WScript.Shell")
sh.Environment("Process")("OLLAMA_HOST") = "0.0.0.0" ' listen on the home network too, so the Pi can reach it
exe = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Ollama\ollama.exe"
sh.Run """" & exe & """ serve", 0, False
