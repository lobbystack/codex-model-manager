$ErrorActionPreference = "Stop"

$AppName = "codex-model-manager"
$Port = if ($env:CMM_PORT) { $env:CMM_PORT } else { "1455" }
$HostName = if ($env:CMM_HOST) { $env:CMM_HOST } else { "127.0.0.1" }
$Repo = $env:CMM_GITHUB_REPO
$InstallRoot = if ($env:CMM_INSTALL_ROOT) { $env:CMM_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "CodexModelManager" }

if (-not $Repo) {
  throw "Set CMM_GITHUB_REPO=owner/repo before running this installer."
}

$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeBin) {
  throw "Node.js 20 or newer is required to run $AppName."
}
$NodeMajor = [int](& $NodeBin -p "Number(process.versions.node.split('.')[0])")
if ($NodeMajor -lt 20) {
  throw "Node.js 20 or newer is required to run $AppName."
}

$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$Asset = "$AppName-win32-$Arch.zip"
$Url = "https://github.com/$Repo/releases/latest/download/$Asset"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "$AppName-install-$([System.Guid]::NewGuid())"
$Archive = Join-Path $TempDir "app.zip"
$PackageDir = Join-Path $TempDir "package"

New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
Write-Host "Downloading $Url"
Invoke-WebRequest -Uri $Url -OutFile $Archive
Expand-Archive -Path $Archive -DestinationPath $PackageDir -Force

$PackageJson = Get-Content (Join-Path $PackageDir "package.json") -Raw | ConvertFrom-Json
$Version = $PackageJson.version
if (-not $Version) {
  throw "Unable to read package version from release artifact."
}

$VersionsDir = Join-Path $InstallRoot "app\versions"
$TargetDir = Join-Path $VersionsDir $Version
$TmpTarget = "$TargetDir.tmp"
$BinDir = Join-Path $InstallRoot "bin"
New-Item -ItemType Directory -Path $VersionsDir, $BinDir -Force | Out-Null
Remove-Item $TmpTarget -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $TmpTarget -Force | Out-Null
Get-ChildItem -Path $PackageDir -Force | Copy-Item -Destination $TmpTarget -Recurse -Force
Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
Move-Item $TmpTarget $TargetDir
Set-Content -Path (Join-Path $InstallRoot "app\active") -Value $TargetDir

$Launcher = Join-Path $BinDir "cmm-launcher.ps1"
@"
`$ErrorActionPreference = "Continue"
`$InstallRoot = "$InstallRoot"
`$NodeBin = "$NodeBin"
while (`$true) {
  `$ActiveDir = (Get-Content (Join-Path `$InstallRoot "app\active") -Raw).Trim()
  Set-Location `$ActiveDir
  `$env:CMM_RELEASE = "1"
  `$env:CMM_GITHUB_REPO = "$Repo"
  `$env:CMM_INSTALL_ROOT = `$InstallRoot
  `$env:NITRO_HOST = "$HostName"
  `$env:NITRO_PORT = "$Port"
  & `$NodeBin ".output/server/index.mjs"
  Start-Sleep -Seconds 2
}
"@ | Set-Content -Path $Launcher

$TaskName = "Codex Model Manager"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 2
Start-Process "http://localhost:$Port"
Write-Host "$AppName $Version is running at http://localhost:$Port"
