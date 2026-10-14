param(
    [Parameter(Mandatory=$true)][string]$Msi,
    [Parameter(Mandatory=$true)][string]$AppImage,
    [Parameter(Mandatory=$true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$Msi = (Resolve-Path $Msi).Path
$AppImage = (Resolve-Path $AppImage).Path
$work = Join-Path $env:RUNNER_TEMP 'HolyCluster-release-smoke'
New-Item -ItemType Directory -Force $work | Out-Null
$installDir = Join-Path $work 'installed'
$installed = $false
try {
    $installLog = Join-Path $work 'install.log'
    $install = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
        '/i', ('"{0}"' -f $Msi), '/qn', '/norestart',
        ('APPLICATIONFOLDER="{0}"' -f $installDir), '/L*v', ('"{0}"' -f $installLog)
    )
    if ($install.ExitCode -notin @(0, 3010)) {
        throw "Candidate MSI installation failed ($($install.ExitCode)); see $installLog"
    }
    $installed = $true
    $exe = Join-Path $installDir 'HolyCluster.exe'
    if (-not (Test-Path -PathType Leaf $exe)) { throw "MSI did not install $exe" }
    $env:CATSERVER_SMOKE_EXE = $exe
    $env:CATSERVER_SMOKE_MSI = $Msi
    $env:CATSERVER_SMOKE_APPIMAGE = $AppImage
    $env:CATSERVER_SMOKE_VERSION = $Version
    $env:CATSERVER_SMOKE_EXPECT_VERSION = ($Version -replace '^catserver-v', '') -replace '-g[0-9a-f]+$', ''
    & node (Join-Path $PSScriptRoot '../../ui/scripts/release_browser_smoke.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Installed CATServer browser smoke test failed ($LASTEXITCODE)" }
} finally {
    if ($installed) {
        $uninstallLog = Join-Path $work 'uninstall.log'
        $uninstall = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
            '/x', ('"{0}"' -f $Msi), '/qn', '/norestart', '/L*v', ('"{0}"' -f $uninstallLog)
        )
        if ($uninstall.ExitCode -notin @(0, 3010)) {
            throw "Candidate MSI removal failed ($($uninstall.ExitCode)); see $uninstallLog"
        }
    }
}
