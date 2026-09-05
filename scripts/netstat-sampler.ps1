<#
.SYNOPSIS
  RELEASING.md criterion 3 — the ~1 s netstat sampler (v1.1.0 design), plus the
  criterion-4 preflight and the post-run analysis.

.DESCRIPTION
  -Preflight  Print what criterion 4 depends on: both outbound-block firewall
              rules (enabled, bound to the installed exes), the staged
              ggml-large-v3-turbo.bin.hold fixture, the installed vibe.exe hash,
              and whether vibe.exe / sona.exe are running.

  -Sample     Run `netstat -ano` every ~1 s for -DurationSeconds (default 150),
              keeping EVERY row of every sample (all states, TIME_WAIT included)
              in <OutDir>\samples.log with a per-sample header carrying the UTC
              time and the vibe/sona/ollama PIDs at that instant. Nothing is
              filtered at capture time, so the analysis is reproducible from
              the raw log. Prints the output directory when done.

  -Analyze    Read a samples.log and report: sample count and window; the
              distinct rows attributable to the app (rows owned by a vibe/sona
              PID, plus PID-0 TIME_WAIT rows whose remote endpoint is the sona
              listener, the Ollama port, or a port a vibe/sona row used); the
              sona listener address in every sample; and the count of
              NON-LOOPBACK rows, which must be zero.

  Sampling is a read-only observation: it opens no sockets and touches nothing
  in the app. Output goes under %TEMP% by default, never into the repository.

.EXAMPLE
  .\scripts\netstat-sampler.ps1 -Preflight
  .\scripts\netstat-sampler.ps1 -Sample -DurationSeconds 150
  .\scripts\netstat-sampler.ps1 -Analyze -InputDir "$env:TEMP\vibe-netstat\20260905T090000Z"
#>
[CmdletBinding(DefaultParameterSetName = 'Preflight')]
param(
    [Parameter(ParameterSetName = 'Preflight')][switch]$Preflight,
    [Parameter(ParameterSetName = 'Sample')][switch]$Sample,
    [Parameter(ParameterSetName = 'Sample')][int]$DurationSeconds = 150,
    [Parameter(ParameterSetName = 'Sample')][string]$OutDir,
    [Parameter(ParameterSetName = 'Analyze')][switch]$Analyze,
    [Parameter(ParameterSetName = 'Analyze', Mandatory)][string]$InputDir,
    [int]$OllamaPort = 11434
)

$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:LOCALAPPDATA 'Vibe Dictation'
$modelsDir  = Join-Path $env:LOCALAPPDATA 'net.nasserhub.dictation'
$appNames   = @('vibe', 'sona', 'ollama')

function Get-AppPids {
    $r = @{}
    foreach ($n in $appNames) {
        $r[$n] = @(Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    }
    return $r
}

function Test-Loopback([string]$endpoint) {
    # endpoint is "addr:port" — IPv6 is "[::1]:port"
    if ($endpoint -match '^\[(.+)\]:\d+$') { $a = $Matches[1] } else { $a = ($endpoint -replace ':\d+$', '') }
    return ($a -eq '127.0.0.1' -or $a -like '127.*' -or $a -eq '::1' -or $a -eq '*')
}

if ($Preflight) {
    "== Criterion-4 preflight, $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') =="
    foreach ($r in Get-NetFirewallRule -DisplayName 'Vibe Dictation*') {
        $p = ($r | Get-NetFirewallApplicationFilter).Program
        "rule    : $($r.DisplayName) | Enabled=$($r.Enabled) | $($r.Direction) $($r.Action) | $p"
    }
    $hold = Join-Path $modelsDir 'ggml-large-v3-turbo.bin.hold'
    if (Test-Path $hold) { "fixture : $hold ($((Get-Item $hold).Length) bytes) — staged" }
    else { "fixture : $hold — NOT PRESENT" }
    Get-ChildItem $modelsDir -Filter 'ggml-*' | ForEach-Object { "model   : $($_.Name) ($($_.Length) bytes)" }
    Get-ChildItem $modelsDir -Filter '*.part' -ErrorAction SilentlyContinue | ForEach-Object { "PART    : $($_.Name) ($($_.Length) bytes) — leftover partial download" }
    $exe = Join-Path $installDir 'vibe.exe'
    "vibe.exe: $((Get-FileHash $exe -Algorithm SHA256).Hash) ($((Get-Item $exe).Length) bytes)"
    $pids = Get-AppPids
    foreach ($n in $appNames) { "running : $n.exe PIDs = $(if ($pids[$n].Count) { $pids[$n] -join ',' } else { 'none' })" }
    return
}

if ($Sample) {
    if (-not $OutDir) { $OutDir = Join-Path $env:TEMP ("vibe-netstat\" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')) }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $log = Join-Path $OutDir 'samples.log'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $n = 0
    Write-Host "Sampling every ~1 s for $DurationSeconds s → $log"
    while ($sw.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $t0 = $sw.Elapsed.TotalSeconds
        $pids = Get-AppPids
        $hdr = "## $((Get-Date).ToUniversalTime().ToString('o')) vibe=$($pids['vibe'] -join ',') sona=$($pids['sona'] -join ',') ollama=$($pids['ollama'] -join ',')"
        $rows = & netstat.exe -ano | Where-Object { $_ -match '^\s+(TCP|UDP)\s' }
        Add-Content -Path $log -Value $hdr
        Add-Content -Path $log -Value $rows
        $n++
        if ($n % 10 -eq 0) { Write-Host ("  {0,4} samples, {1,5:N0} s elapsed" -f $n, $sw.Elapsed.TotalSeconds) }
        $wait = 1.0 - ($sw.Elapsed.TotalSeconds - $t0)
        if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
    }
    "done: $n samples in $([int]$sw.Elapsed.TotalSeconds) s → $OutDir"
    return
}

if ($Analyze) {
    $log = Join-Path $InputDir 'samples.log'
    if (-not (Test-Path $log)) { throw "no samples.log in $InputDir" }
    $samples = @(); $cur = $null
    foreach ($line in Get-Content $log) {
        if ($line -like '## *') {
            if ($cur) { $samples += $cur }
            $m = [regex]::Match($line, '^## (\S+) vibe=(\S*) sona=(\S*) ollama=(\S*)')
            $cur = [pscustomobject]@{
                Time = $m.Groups[1].Value
                Pids = @{
                    vibe   = @($m.Groups[2].Value -split ',' | Where-Object { $_ })
                    sona   = @($m.Groups[3].Value -split ',' | Where-Object { $_ })
                    ollama = @($m.Groups[4].Value -split ',' | Where-Object { $_ })
                }
                Rows = New-Object System.Collections.Generic.List[object]
            }
        } elseif ($cur -and $line -match '^\s+(TCP|UDP)\s+(\S+)\s+(\S+)\s+(\S+)?\s*(\d+)\s*$') {
            $proto = $Matches[1]; $local = $Matches[2]; $remote = $Matches[3]
            if ($proto -eq 'UDP') { $state = ''; $pid_ = $Matches[5] } else { $state = $Matches[4]; $pid_ = $Matches[5] }
            $cur.Rows.Add([pscustomobject]@{ Proto=$proto; Local=$local; Remote=$remote; State=$state; Pid=$pid_ })
        }
    }
    if ($cur) { $samples += $cur }
    "samples : $($samples.Count)  window: $($samples[0].Time) → $($samples[-1].Time)"

    # Pass 1: endpoints used by vibe/sona rows, and the sona listener(s).
    $appPorts = @{}
    $sonaListen = @{}
    foreach ($s in $samples) {
        $own = @($s.Pids.vibe + $s.Pids.sona)
        foreach ($r in $s.Rows) {
            if ($own -contains $r.Pid) {
                $appPorts[$r.Local] = $true
                if ($r.State -eq 'LISTENING' -and ($s.Pids.sona -contains $r.Pid)) { $sonaListen[$r.Local] = $true }
            }
        }
    }
    "sona listener endpoints seen: $(($sonaListen.Keys | Sort-Object) -join ', ')"
    $bad0 = @($sonaListen.Keys | Where-Object { $_ -like '0.0.0.0:*' -or $_ -like '[[]::]:*' })
    if ($bad0.Count) { "FAIL    : sona listening on a wildcard address: $($bad0 -join ', ')" }

    # Pass 2: attributable rows per sample.
    $dist = @{}
    $nonLoop = @{}
    $listenPerSample = 0
    foreach ($s in $samples) {
        $own = @($s.Pids.vibe + $s.Pids.sona)
        $sawListen = $false
        foreach ($r in $s.Rows) {
            $owner = ''
            if     ($s.Pids.vibe   -contains $r.Pid) { $owner = 'vibe' }
            elseif ($s.Pids.sona   -contains $r.Pid) { $owner = 'sona' }
            elseif ($s.Pids.ollama -contains $r.Pid) { $owner = 'ollama' }
            elseif ($r.State -eq 'TIME_WAIT' -and $r.Pid -eq '0') {
                $rp = $r.Remote -replace '^.*:', ''
                if ($sonaListen.ContainsKey($r.Remote) -or $rp -eq "$OllamaPort" -or $appPorts.ContainsKey($r.Local) -or $appPorts.ContainsKey($r.Remote)) { $owner = 'pid0-timewait' }
            }
            if (-not $owner) { continue }
            if ($owner -eq 'sona' -and $r.State -eq 'LISTENING') { $sawListen = $true }
            $key = "{0,-4} {1,-24} {2,-24} {3,-12} {4}" -f $r.Proto, $r.Local, $r.Remote, $r.State, $owner
            if (-not $dist.ContainsKey($key)) { $dist[$key] = 0 }
            $dist[$key]++
            if (-not ((Test-Loopback $r.Local) -and (Test-Loopback $r.Remote))) { $nonLoop[$key] = $dist[$key] }
        }
        if ($sawListen) { $listenPerSample++ }
    }
    "sona LISTENING present in $listenPerSample of $($samples.Count) samples"
    ""
    "distinct attributable rows: $($dist.Count)   (count = samples the row appeared in)"
    "{0,5}  {1,-4} {2,-24} {3,-24} {4,-12} {5}" -f 'n', 'prot', 'local', 'remote', 'state', 'owner'
    foreach ($k in ($dist.Keys | Sort-Object)) { "{0,5}  {1}" -f $dist[$k], $k }
    ""
    if ($nonLoop.Count -eq 0) { "NON-LOOPBACK rows: 0  → loopback-only holds" }
    else { "NON-LOOPBACK rows: $($nonLoop.Count)  → FAIL"; foreach ($k in $nonLoop.Keys) { "   $k" } }
    return
}

Write-Host "Use -Preflight, -Sample [-DurationSeconds N] [-OutDir path], or -Analyze -InputDir path"
