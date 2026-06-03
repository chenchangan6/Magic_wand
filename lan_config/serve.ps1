$ErrorActionPreference = 'Stop'
trap {
    Write-Host ''
    Write-Host 'Local config launcher failed:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to close'
    break
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = $null
$port = $null

function Test-LocalPortFree([int]$CandidatePort) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $CandidatePort)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

function Stop-OldLocalConfigServers {
    $owners = @()
    foreach ($candidatePort in 8777..8787) {
        try {
            $connections = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue
        } catch {
            $connections = @()
        }
        foreach ($connection in $connections) {
            if ($connection.OwningProcess) {
                $owners += [int]$connection.OwningProcess
            }
        }
    }

    $owners = $owners | Sort-Object -Unique
    foreach ($ownerPid in $owners) {
        try {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid"
            $cmd = [string]$proc.CommandLine
            if ($cmd -notmatch 'serve\.py') {
                continue
            }
            Write-Host "Stopping old local config server (PID $ownerPid)."
            Stop-Process -Id $ownerPid -Force
        } catch {
            Write-Warning "Could not stop old local config server PID ${ownerPid}: $($_.Exception.Message)"
        }
    }
}

function Start-StaticFlashServer([int]$ListenPort, [string]$OpenUrl) {
    $listener = [System.Net.HttpListener]::new()
    $prefix = "http://127.0.0.1:$ListenPort/"
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    Write-Host "Python was not found. Static flasher server started at $OpenUrl"
    Start-Process $OpenUrl

    try {
        while ($listener.IsListening) {
            $context = $listener.GetContext()
            $requestPath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
            if (-not $requestPath) {
                $requestPath = 'flash.html'
            }
            $requestPath = $requestPath -replace '/', [IO.Path]::DirectorySeparatorChar
            $fullPath = [IO.Path]::GetFullPath((Join-Path $root $requestPath))
            if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                $context.Response.StatusCode = 403
                $context.Response.Close()
                continue
            }
            if (-not (Test-Path $fullPath -PathType Leaf)) {
                $context.Response.StatusCode = 404
                $context.Response.Close()
                continue
            }

            $ext = [IO.Path]::GetExtension($fullPath).ToLowerInvariant()
            $contentType = switch ($ext) {
                '.html' { 'text/html; charset=utf-8' }
                '.json' { 'application/json; charset=utf-8' }
                '.js' { 'text/javascript; charset=utf-8' }
                '.css' { 'text/css; charset=utf-8' }
                '.bin' { 'application/octet-stream' }
                default { 'application/octet-stream' }
            }
            $bytes = [IO.File]::ReadAllBytes($fullPath)
            $context.Response.Headers.Set('Access-Control-Allow-Origin', '*')
            $context.Response.Headers.Set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            $context.Response.ContentType = $contentType
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.Close()
        }
    } finally {
        $listener.Stop()
        $listener.Close()
    }
}

Stop-OldLocalConfigServers

foreach ($candidatePort in 8777..8787) {
    if (Test-LocalPortFree -CandidatePort $candidatePort) {
        $port = $candidatePort
        break
    }
}
if (-not $port) {
    throw 'No free localhost port found in the 8777-8787 range.'
}

$startPath = [string]$env:MAGIC_START_PATH
if (-not $startPath) {
    $startPath = '/'
}
if (-not $startPath.StartsWith('/')) {
    $startPath = '/' + $startPath
}
$url = "http://127.0.0.1:$port$startPath"
$statusUrl = "http://127.0.0.1:$port/api/status"
$env:MAGIC_LAN_PORT = [string]$port

$preferred = 'C:\Espressif\tools\python\v6.0\venv\Scripts\python.exe'
if (Test-Path $preferred) {
    $python = $preferred
}

foreach ($candidate in @('python', 'py')) {
    if ($python) { break }
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        $python = $cmd.Source
        break
    }
}

if (-not $python -and (Test-Path 'C:\ProgramData\miniconda3\python.exe')) {
    $python = 'C:\ProgramData\miniconda3\python.exe'
}

if (-not $python) {
    if ($startPath -eq '/flash.html') {
        Start-StaticFlashServer -ListenPort $port -OpenUrl $url
        return
    }
    throw 'Python or py was not found. Please install Python before running the full local config page. For firmware flashing only, run start_flasher.cmd.'
}

Write-Host "MagicWand local tool starting at $url"
$server = Start-Process -FilePath $python -ArgumentList @('serve.py') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
    for ($i = 0; $i -lt 50; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing $statusUrl | Out-Null
            break
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    Start-Process $url
    try {
        Wait-Process -Id $server.Id
    } catch {
        Write-Warning "Local config page exited before the launcher finished waiting."
    }
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
}
