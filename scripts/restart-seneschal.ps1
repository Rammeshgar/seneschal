param([switch] $TasksFinished)
$ErrorActionPreference = 'Stop'

function Get-SeneschalHost([string] $AppRoot) {
  $lockFile = Join-Path $AppRoot 'data\seneschal-instance.lock'
  if (-not (Test-Path -LiteralPath $lockFile)) { return $null }
  $hostId = 0
  if (-not [int]::TryParse([IO.File]::ReadAllText($lockFile).Trim(), [ref] $hostId) -or $hostId -le 0) {
    throw 'The Seneschal lock is invalid. Nothing was stopped.'
  }
  # CIM failure must propagate; lack of access is not proof that a process exited.
  $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$hostId" -ErrorAction Stop
  if (-not $hostProcess) { return $null }
  $serverPath = [regex]::Escape((Join-Path $AppRoot 'server.js'))
  $expectedCommand = '^\s*(?:"[^"]*\\node\.exe"|[^\s"]*\\node\.exe)\s+(?:"' + $serverPath + '"|' + $serverPath + ')\s*$'
  if ($hostProcess.Name -ne 'node.exe' -or -not $hostProcess.CommandLine -or
      $hostProcess.CommandLine -notmatch $expectedCommand -or -not $hostProcess.CreationDate) {
    throw 'The saved process is not this Seneschal host. Nothing was stopped.'
  }
  # CIM dates have different precision from Process.StartTime. Capture native
  # ticks now and compare them with native ticks at stop, never across APIs.
  $nativeSnapshot = Get-Process -Id $hostId -ErrorAction Stop
  try {
    $null = $nativeSnapshot.Handle
    $nativeTicks = $nativeSnapshot.StartTime.ToUniversalTime().Ticks
    $confirmed = Get-CimInstance Win32_Process -Filter "ProcessId=$hostId" -ErrorAction Stop
    if (-not $confirmed -or $confirmed.CreationDate -ne $hostProcess.CreationDate -or
        $confirmed.Name -ne $hostProcess.Name -or $confirmed.CommandLine -cne $hostProcess.CommandLine) {
      throw 'The Seneschal host changed while capturing its identity. Nothing was stopped.'
    }
    $hostProcess | Add-Member -NotePropertyName NativeStartTicks -NotePropertyValue $nativeTicks -Force
  } finally { $nativeSnapshot.Dispose() }
  return $hostProcess
}

function Get-SeneschalEngineContext([string] $AppRoot) {
  $settingsFile = Join-Path $AppRoot 'data\settings.json'
  $settings = if (Test-Path -LiteralPath $settingsFile) { [IO.File]::ReadAllText($settingsFile) | ConvertFrom-Json } else { $null }
  $distribution = if ($env:SENESCHAL_WSL_DISTRO) { $env:SENESCHAL_WSL_DISTRO } elseif ($env:DIGITAL_SERVANT_WSL_DISTRO) { $env:DIGITAL_SERVANT_WSL_DISTRO } elseif ($settings.wslDistribution) { $settings.wslDistribution } else { 'Ubuntu' }
  if ($distribution -notmatch '^[A-Za-z0-9_. -]{1,64}$') { throw 'The configured WSL distribution is invalid.' }
  $passwordFile = Join-Path $AppRoot 'data\server-password.txt'
  if (-not (Test-Path -LiteralPath $passwordFile)) { throw 'Engine ownership cannot be checked: the local server credential is missing.' }
  # Only its one-way fingerprint is passed to WSL. Never print the credential.
  $password = [IO.File]::ReadAllText($passwordFile).Trim()
  if ($password.Length -lt 20) { throw 'The local engine credential is invalid.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($password)))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $password = $null }
  return @{ Distribution = $distribution; Fingerprint = $fingerprint }
}

function Invoke-SeneschalEngineGuard($EngineContext, [string] $Mode, [string] $ExpectedIdentity = 'absent') {
  # Literal script only: no interpolated shell commands, passwords, broad kills,
  # distro termination, or changes to config/history. timeout bounds each call.
  $guard = @'
set -euo pipefail
mode=$1
expected_hash=$2
expected_identity=$3
[[ "$mode" == probe || "$mode" == stop || "$mode" == empty ]] || exit 10
[[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || exit 10
command -v ss >/dev/null
command -v sha256sum >/dev/null

listener_pid() {
  local lines state receive send address rest found= candidate
  lines=$(ss -H -ltnp 'sport = :4097') || return 11
  if [[ -z "$lines" ]]; then printf absent; return; fi
  while read -r state receive send address rest; do
    [[ "$state" == LISTEN && "$address" == 127.0.0.1:4097 ]] || return 12
    [[ "$rest" =~ pid=([0-9]+) ]] || return 13
    candidate=${BASH_REMATCH[1]}
    [[ -z "$found" || "$found" == "$candidate" ]] || return 14
    found=$candidate
    rest=${rest#*pid=$candidate}
    [[ ! "$rest" =~ pid= ]] || return 14
  done <<< "$lines"
  [[ "$found" =~ ^[1-9][0-9]*$ ]] || return 15
  printf '%s' "$found"
}

identity() {
  local target=$1 entry secret= username= actual_hash stat
  local -a args fields
  [[ -r "/proc/$target/cmdline" && -r "/proc/$target/environ" ]] || return 16
  mapfile -d '' -t args < "/proc/$target/cmdline"
  [[ ${#args[@]} == 6 && "${args[0]##*/}" == opencode &&
     "${args[1]}" == serve && "${args[2]}" == --hostname &&
     "${args[3]}" == 127.0.0.1 && "${args[4]}" == --port &&
     "${args[5]}" == 4097 ]] || return 17
  while IFS= read -r -d '' entry; do
    case "$entry" in
      OPENCODE_SERVER_PASSWORD=*) secret=${entry#*=} ;;
      OPENCODE_SERVER_USERNAME=*) username=${entry#*=} ;;
    esac
  done < "/proc/$target/environ"
  [[ "$username" == opencode && -n "$secret" ]] || return 18
  actual_hash=$(printf '%s' "$secret" | sha256sum)
  unset secret entry
  [[ "${actual_hash%% *}" == "$expected_hash" ]] || return 19
  stat=$(<"/proc/$target/stat")
  read -r -a fields <<< "${stat##*) }"
  [[ "${fields[19]}" =~ ^[0-9]+$ ]] || return 20
  printf '%s:%s' "$target" "${fields[19]}"
}

target=$(listener_pid) || exit 21
if [[ "$mode" == empty ]]; then [[ "$target" == absent ]] || exit 22; printf absent; exit; fi
if [[ "$target" == absent ]]; then printf absent; exit; fi
current=$(identity "$target") || exit 23
if [[ "$mode" == probe ]]; then printf '%s' "$current"; exit; fi
[[ "$expected_identity" =~ ^[1-9][0-9]*:[0-9]+$ && "$current" == "$expected_identity" ]] || exit 24
# Recheck immediately before SIGTERM. PID plus start ticks defend against reuse.
[[ "$(listener_pid)" == "$target" && "$(identity "$target")" == "$current" ]] || exit 25
kill -TERM -- "$target"
for attempt in {1..80}; do
  stat=
  if [[ ! -r "/proc/$target/stat" ]]; then break; fi
  stat=$(<"/proc/$target/stat")
  read -r -a fields <<< "${stat##*) }"
  [[ "${fields[19]}" == "${current#*:}" && "${fields[0]}" != Z ]] || break
  sleep 0.1
done
[[ "$(listener_pid)" == absent ]] || exit 26
printf absent
'@
  $output = $guard.Replace("`r", '') | & wsl.exe -d $EngineContext.Distribution -- timeout 15s bash -s -- $Mode $EngineContext.Fingerprint $ExpectedIdentity 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Could not safely inspect or stop the Seneschal engine in WSL. No unverified engine was stopped; no new host was launched.' }
  $result = ($output -join "`n").Trim()
  if ($result -ne 'absent' -and $result -notmatch '^[1-9][0-9]*:[0-9]+$') { throw 'WSL returned an unexpected engine identity. Restart stopped.' }
  return $result
}

function Stop-SeneschalHost($HostProcess) {
  if (-not $HostProcess) { return }
  $nativeHost = Get-Process -Id $HostProcess.ProcessId -ErrorAction Stop
  try {
    # Keep the exact process handle, rather than later killing a recycled PID.
    $null = $nativeHost.Handle
    if (-not $HostProcess.NativeStartTicks -or
        $nativeHost.StartTime.ToUniversalTime().Ticks -ne $HostProcess.NativeStartTicks) {
      throw 'The Seneschal host identity changed. Nothing was stopped.'
    }
    $nativeHost.Kill()
    if (-not $nativeHost.WaitForExit(10000)) { throw 'The old Seneschal host did not exit. No new host was launched.' }
  } finally { $nativeHost.Dispose() }
}

function Start-SeneschalHost([string] $AppRoot) {
  $launcher = Join-Path $AppRoot 'scripts\launch.ps1'
  Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"')) -WindowStyle Hidden
}

function Invoke-SeneschalRestart([string] $AppRoot, [switch] $TasksFinished) {
  $AppRoot = [IO.Path]::GetFullPath($AppRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'scripts\launch.ps1'))) { throw 'Seneschal launcher is missing. Nothing was stopped.' }
  if (-not $TasksFinished) {
    $confirmation = Read-Host 'Finish all PC/phone tasks first. Type RESTART to restart only Seneschal and its engine'
    if ($confirmation -cne 'RESTART') { Write-Output 'Restart cancelled. Nothing was stopped.'; return }
  }
  # Complete all access/ownership checks before stopping the Windows host.
  $initialHost = Get-SeneschalHost $AppRoot
  $engineContext = Get-SeneschalEngineContext $AppRoot
  $engineIdentity = Invoke-SeneschalEngineGuard $engineContext 'probe'
  $currentHost = Get-SeneschalHost $AppRoot
  if (($null -eq $initialHost) -ne ($null -eq $currentHost) -or
      ($initialHost -and ($initialHost.ProcessId -ne $currentHost.ProcessId -or
        $initialHost.CreationDate -ne $currentHost.CreationDate -or $initialHost.NativeStartTicks -ne $currentHost.NativeStartTicks))) {
    throw 'The Seneschal host changed during inspection. Nothing was stopped.'
  }
  # The guard compares this second probe and the final stop with the same identity.
  $currentEngine = Invoke-SeneschalEngineGuard $engineContext 'probe'
  if ($currentEngine -ne $engineIdentity) { throw 'The engine changed during inspection. Nothing was stopped.' }
  Stop-SeneschalHost $currentHost
  $null = Invoke-SeneschalEngineGuard $engineContext 'stop' $engineIdentity
  $null = Invoke-SeneschalEngineGuard $engineContext 'empty'
  if (Get-SeneschalHost $AppRoot) { throw 'The old host is still running. No new host was launched.' }
  Start-SeneschalHost $AppRoot
  Write-Output 'Old host and verified engine stopped; Seneschal launch requested. History and sign-in files are unchanged. Open Phone access to reconnect if needed.'
}

# Dot-sourcing only defines functions, allowing tests with synthetic process mocks.
if ($MyInvocation.InvocationName -ne '.') {
  Invoke-SeneschalRestart -AppRoot (Split-Path -Parent $PSScriptRoot) -TasksFinished:$TasksFinished
}
