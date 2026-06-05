Option Explicit

Dim shell, fso, scriptDir, agentDir, server, nodePath, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
agentDir = fso.GetParentFolderName(scriptDir)
server = fso.BuildPath(agentDir, "dist\server.js")
nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")

If Not fso.FileExists(nodePath) Then
  nodePath = "node"
End If

If Not fso.FileExists(server) Then
  WScript.Echo "Build the print agent first: pnpm --filter @bizbil/print-agent build"
  WScript.Quit 1
End If

shell.CurrentDirectory = agentDir
command = """" & nodePath & """ """ & server & """"

' 0 = hidden window, True = keep scheduled task alive while node is running.
WScript.Quit shell.Run(command, 0, True)
