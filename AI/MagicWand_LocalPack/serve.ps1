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

foreach ($candidatePort in 8777..8787) {
    if (Test-LocalPortFree -CandidatePort $candidatePort) {
        $port = $candidatePort
        break
    }
}
if (-not $port) {
    throw 'No free localhost port found in the 8777-8787 range.'
}

$url = "http://127.0.0.1:$port/"
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
    throw 'Python or py was not found. Please install Python before running this local config page.'
}

$existingPids = Get-NetTCPConnection -LocalPort 8777 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object -ExpandProperty OwningProcess -Unique
foreach ($ownerPid in $existingPids) {
    try {
        $proc = Get-Process -Id $ownerPid -ErrorAction Stop
        Write-Host "Stopping old local config server on port 8777 (PID $ownerPid)."
        Stop-Process -Id $ownerPid -Force
    } catch {
        Write-Warning "Could not stop old local config server PID ${ownerPid}: $($_.Exception.Message)"
    }
}

Write-Host "Local config page starting at $url (page + local save, controller connects directly)"
$server = Start-Process -FilePath $python -ArgumentList @('serve.py') -WorkingDirectory $root -WindowStyle Hidden -PassThru
try {
    for ($i = 0; $i -lt 50; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing "$url/api/status" | Out-Null
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
