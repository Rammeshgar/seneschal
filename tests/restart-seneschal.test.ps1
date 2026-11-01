$ErrorActionPreference = 'Stop'
# Synthetic process/WSL functions only. Never invokes a real restart.
$restartPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\restart-seneschal.ps1'
$tokens = $null; $parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($restartPath, [ref] $tokens, [ref] $parseErrors)
if ($parseErrors.Count) { throw 'Restart script syntax failed.' }
. $restartPath
$script:originalHostStop = ${function:Stop-SeneschalHost}
$script:passed = 0
function Assert-True($Condition, [string] $Message) { if (-not $Condition) { throw $Message } }
function Test-Restart([string] $Name, [scriptblock] $Body) {
  & $Body
  $script:passed++
  Write-Output "PASS: $Name"
}
function Reset-Fixture {
  $script:events = [Collections.Generic.List[string]]::new()
  $script:hostReads = 0
  $script:engineReads = 0
  $script:hostChanged = $false; $script:engineChanged = $false; $script:denied = $false; $script:stopFailed = $false
  $script:noHost = $false; $script:answer = 'RESTART'
}
function Test-Path { param($LiteralPath) return $true }
function Read-Host { param($Prompt) return $script:answer }
function Get-SeneschalHost {
  param($AppRoot)
  $script:hostReads++
  if ($script:noHost -or $script:events.Contains('host-stop')) { return $null }
  $created = if ($script:hostChanged -and $script:hostReads -gt 1) { [datetime]'2026-01-02' } else { [datetime]'2026-01-01' }
  return [pscustomobject]@{ ProcessId=1234; CreationDate=$created; NativeStartTicks=$created.ToUniversalTime().Ticks; Name='node.exe' }
}
function Get-SeneschalEngineContext { param($AppRoot) return @{ Distribution='Fixture'; Fingerprint=('a' * 64) } }
function Invoke-SeneschalEngineGuard {
  param($EngineContext, $Mode, $ExpectedIdentity)
  $script:events.Add("engine-$Mode")
  if ($script:denied) { throw 'Fixture WSL denied' }
  if ($Mode -eq 'probe') {
    $script:engineReads++
    if ($script:engineChanged -and $script:engineReads -eq 2) { return '9877:2' }
    return '9876:1'
  }
  if ($Mode -eq 'stop') {
    Assert-True ($ExpectedIdentity -eq '9876:1') 'Stop did not retain the verified identity.'
    if ($script:stopFailed) { throw 'Fixture identity changed' }
  }
  return 'absent'
}
function Stop-SeneschalHost { param($HostProcess) $script:events.Add('host-stop') }
function Start-SeneschalHost { param($AppRoot) $script:events.Add('host-start') }
function Assert-NoMutation {
  Assert-True (-not $script:events.Contains('host-stop')) 'Unexpected host stop.'
  Assert-True (-not $script:events.Contains('engine-stop')) 'Unexpected engine stop.'
  Assert-True (-not $script:events.Contains('host-start')) 'Unexpected relaunch.'
}
Test-Restart 'only the verified host and engine stop, then launch once' {
  Reset-Fixture
  $null = Invoke-SeneschalRestart -AppRoot $PSScriptRoot -TasksFinished
  Assert-True (($script:events -join ',') -eq 'engine-probe,engine-probe,host-stop,engine-stop,engine-empty,host-start') 'Restart order changed.'
}
Test-Restart 'WSL access denial leaves the host running' {
  Reset-Fixture; $script:denied=$true
  try { $null=Invoke-SeneschalRestart -AppRoot $PSScriptRoot -TasksFinished; throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -eq 'Fixture WSL denied') 'Wrong error.' }
  Assert-NoMutation
}
Test-Restart 'engine changes between probes cause no stop' {
  Reset-Fixture; $script:engineChanged=$true
  try { $null=Invoke-SeneschalRestart -AppRoot $PSScriptRoot -TasksFinished; throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -match 'engine changed') 'Wrong error.' }
  Assert-NoMutation
}
Test-Restart 'host changes between probes cause no stop' {
  Reset-Fixture; $script:hostChanged=$true
  try { $null=Invoke-SeneschalRestart -AppRoot $PSScriptRoot -TasksFinished; throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -match 'host changed') 'Wrong error.' }
  Assert-NoMutation
}
Test-Restart 'failed final ownership check never launches a replacement host' {
  Reset-Fixture; $script:stopFailed=$true
  try { $null=Invoke-SeneschalRestart -AppRoot $PSScriptRoot -TasksFinished; throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -eq 'Fixture identity changed') 'Wrong error.' }
  Assert-True (-not $script:events.Contains('host-start')) 'Unsafe relaunch.'
}
Test-Restart 'cancelled confirmation inspects or stops nothing' {
  Reset-Fixture; $script:answer='no'
  $null=Invoke-SeneschalRestart -AppRoot $PSScriptRoot
  Assert-True ($script:events.Count -eq 0) 'Cancellation had side effects.'
}
Test-Restart 'native host stop retains a handle and rejects a recycled PID' {
  $script:killCount=0; $script:disposed=0
  $script:nativeFixture=[pscustomobject]@{ Handle=[IntPtr]::Zero; StartTime=[datetime]'2026-01-02' }
  $script:nativeFixture | Add-Member ScriptMethod Kill { $script:killCount++ }
  $script:nativeFixture | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
  $script:nativeFixture | Add-Member ScriptMethod Dispose { $script:disposed++ }
  function Get-Process { param($Id, $ErrorAction) return $script:nativeFixture }
  $originalTicks=([datetime]'2026-01-01').ToUniversalTime().Ticks
  try { & $script:originalHostStop ([pscustomobject]@{ ProcessId=1234; CreationDate=[datetime]'2026-01-01'; NativeStartTicks=$originalTicks }); throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -match 'identity changed') 'Wrong error.' }
  Assert-True ($script:killCount -eq 0 -and $script:disposed -eq 1) 'Recycled PID was killed.'
  $script:nativeFixture.StartTime=[datetime]'2026-01-01'
  & $script:originalHostStop ([pscustomobject]@{ ProcessId=1234; CreationDate=[datetime]'2026-01-01'; NativeStartTicks=$originalTicks })
  Assert-True ($script:killCount -eq 1 -and $script:disposed -eq 2) 'Verified handle was not closed.'
}
Test-Restart 'CIM timestamp precision does not falsely reject unchanged native start ticks' {
  $script:killCount=0; $script:disposed=0
  $nativeTime=([datetime]'2026-01-01').AddTicks(7)
  $script:nativeFixture=[pscustomobject]@{ Handle=[IntPtr]::Zero; StartTime=$nativeTime }
  $script:nativeFixture | Add-Member ScriptMethod Kill { $script:killCount++ }
  $script:nativeFixture | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
  $script:nativeFixture | Add-Member ScriptMethod Dispose { $script:disposed++ }
  function Get-Process { param($Id, $ErrorAction) return $script:nativeFixture }
  & $script:originalHostStop ([pscustomobject]@{ ProcessId=1234; CreationDate=[datetime]'2026-01-01'; NativeStartTicks=$nativeTime.ToUniversalTime().Ticks })
  Assert-True ($script:killCount -eq 1 -and $script:disposed -eq 1) 'Precision mismatch rejected the same native identity.'
  $script:nativeFixture.StartTime=$nativeTime.AddTicks(1)
  try { & $script:originalHostStop ([pscustomobject]@{ ProcessId=1234; NativeStartTicks=$nativeTime.ToUniversalTime().Ticks }); throw 'Did not deny.' } catch { Assert-True ($_.Exception.Message -match 'identity changed') 'Wrong error.' }
  Assert-True ($script:killCount -eq 1) 'Even a changed native tick must be rejected.'
}
Test-Restart 'engine guard has exact port, command, credential fingerprint and start-time checks' {
  $source=[IO.File]::ReadAllText($restartPath)
  foreach($text in @("sport = :4097", 'OPENCODE_SERVER_PASSWORD=', 'OPENCODE_SERVER_USERNAME=', 'sha256sum', 'kill -TERM -- "$target"', 'fields[19]', 'timeout 15s bash', 'expected_identity')) {
    Assert-True ($source.Contains($text)) "Missing guard: $text"
  }
  Assert-True ($source -notmatch '(?m)^\s*(?:pkill|killall|wsl\.exe\s+--(?:shutdown|terminate))\b') 'Broad process stop found.'
}
Write-Output "$script:passed synthetic restart checks passed. No live process, WSL engine or launcher was invoked."
