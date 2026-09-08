[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Status',
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [switch]$NoBuild
)

# Local game process management only. This script does not create a tunnel.
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $projectRoot '.runtime'
$recordFile = Join-Path $runtimeDir 'game-process.json'
$serverFile = Join-Path $projectRoot 'server\index.js'

function Get-ProjectRecord {
    if (-not (Test-Path -LiteralPath $recordFile)) { return $null }
    try { return Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json }
    catch { throw 'The project PID record is unreadable. No process has been stopped.' }
}

function Get-OwnedProcess($record) {
    if ($null -eq $record) { return $null }
    if ([string]$record.projectRoot -ne $projectRoot -or [string]$record.serverFile -ne $serverFile) { return $null }
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $null }
    $savedStart = [DateTime]::Parse([string]$record.startTimeUtc).ToUniversalTime()
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $savedStart).TotalSeconds) -gt 1) { return $null }
    if (-not [string]::Equals($process.Path, [string]$record.executable, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    $details = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.pid)
    if ($null -eq $details -or -not ([string]$details.CommandLine).Contains($serverFile)) { return $null }
    return $process
}

function Find-Node {
    $candidates = @()
    if ($env:DUST2_NODE) { $candidates += $env:DUST2_NODE }
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $candidates += $nodeCommand.Source }
    $candidates += (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    $candidates += 'C:\Program Files\nodejs\node.exe'
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
    }
    throw 'Node.js was not found. Install a supported Node.js version or set DUST2_NODE to node.exe.'
}

$record = Get-ProjectRecord
$owned = Get-OwnedProcess $record

if ($Action -eq 'Status') {
    if ($owned) { Write-Output ('Running: PID {0}, http://localhost:{1}/' -f $owned.Id, $record.port) }
    else { Write-Output 'This launcher has no verified running game process.' }
    exit 0
}

if ($Action -eq 'Stop') {
    if ($owned) {
        # Recheck immediately before stopping to reject stale/reused PID records.
        $owned = Get-OwnedProcess $record
        if ($null -eq $owned) { throw 'Process identity changed; nothing was stopped.' }
        Stop-Process -Id $owned.Id -ErrorAction Stop
        Write-Output ('Stopped this project game process: PID ' + $owned.Id)
        Remove-Item -LiteralPath $recordFile
    } elseif ($record) {
        Write-Output 'The PID record is stale or belongs to a different process. No process was stopped.'
        Remove-Item -LiteralPath $recordFile
    } else {
        Write-Output 'This launcher has no game process to stop.'
    }
    exit 0
}

if ($owned) {
    Write-Output ('Game already running: http://localhost:{0}/ (PID {1})' -f $record.port, $owned.Id)
    exit 0
}
if (-not (Test-Path -LiteralPath $serverFile)) { throw 'server/index.js is missing. Finish the project setup first.' }
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw ('Port {0} is already in use. This launcher will not stop or adopt that process. Choose another -Port or use the existing server.' -f $Port) }
$nodeExe = Find-Node
$viteFile = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteFile)) { throw 'Dependencies are missing. Run npm install in the project directory first.' }

Push-Location -LiteralPath $projectRoot
try {
    if (-not $NoBuild) {
        Write-Output 'Building the browser client...'
        & $nodeExe $viteFile build
        if ($LASTEXITCODE -ne 0) { throw 'The browser build failed. The server was not started.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'dist/index.html is missing. Run the build first.' }
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $runtimeDir ('game-' + $stamp + '.out.log')
    $stderr = Join-Path $runtimeDir ('game-' + $stamp + '.err.log')
    $oldPort = $env:PORT
    try {
        $env:PORT = [string]$Port
        $process = Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    } finally {
        $env:PORT = $oldPort
    }
    $record = [PSCustomObject]@{
        projectRoot = $projectRoot
        serverFile = $serverFile
        executable = $nodeExe
        pid = $process.Id
        startTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
        port = $Port
        stdout = $stdout
        stderr = $stderr
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) {
            if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Tail 20 }
            throw ('Game server exited. See ' + $stderr)
        }
        try {
            $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/') -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw ('Server process started but readiness timed out. Check ' + $stderr + ' or run Stop-Game.cmd.') }
    Write-Output ('Game ready: http://localhost:{0}/' -f $Port)
    Write-Output ('Background PID: {0}; logs: {1}' -f $process.Id, $runtimeDir)
    Write-Output 'Use Stop-Game.cmd to stop this project server.'
} finally {
    Pop-Location
}
