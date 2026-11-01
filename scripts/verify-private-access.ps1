$ErrorActionPreference = 'Stop'
$repoDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceFiles = @('scripts/private-access-policy.cjs', 'scripts/private-access-gateway.cjs', 'scripts/private-access.cjs', 'scripts/phone-access-control.cjs', 'app/phone-access.js', 'app/phone-access.css', 'app/private-access.css', 'app/private-access.js', 'app/activity.js', 'app/app.js', 'app/index.html', 'server.js', 'tests/private-access.test.js', 'scripts/verify-private-access.ps1', 'scripts/moli-mcp.cjs', 'tests/moli.test.js')
$sourceFiles += @('app/questions.js', 'app/questions.css', 'tests/questions.test.js')
$sourceFiles += @('scripts/activity-server.js', 'tests/activity-startup.test.js')
$sourceFiles += @('scripts/backup-files.cjs', 'scripts/backup-worker.cjs', 'scripts/backup-manager.cjs', 'scripts/backup-opencode.ps1', 'tests/backups.test.js')
$sourceFiles += @('scripts/nvidia-speech.cjs', 'app/nvidia-speech.js', 'app/styles.css', 'tests/nvidia-speech.test.js')
$sourceFiles += @('app/ares.js', 'app/ares-scene.js', 'app/ares.css', 'app/assets/ares/ares.glb', 'app/assets/ares/three.module.js', 'app/assets/ares/GLTFLoader.js', 'app/assets/ares/BufferGeometryUtils.js', 'app/assets/ares/THREE-LICENSE.txt', 'tests/ares.test.js')
$sourceFiles += @('app/wallpapers.js', 'app/wallpapers.css', 'app/wallpapers/legacy-worlds.js', 'app/wallpapers/citylight-world.js', 'app/wallpapers/afterlight-worlds.js', 'app/wallpapers/afterlight-engine.js', 'tests/wallpapers-host.test.js')
$sourceFiles += @('tests/wallpapers-host-fixture.cjs', 'tests/original-motion-controls.test.js')
$image = 'node:22-bookworm-slim'
$dockerPath = (Get-Command docker.exe -ErrorAction Stop).Source
$containerId = $null
$clientProcess = $null

function Assert-RegularFile([string] $filePath) {
  $item = Get-Item -LiteralPath $filePath -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Verification requires ordinary source files, not links.' }
  if ($filePath.Contains('"') -or $filePath.Contains("`n") -or $filePath.Contains(',')) { throw 'Unsupported source path for an isolated mount.' }
}

try {
  # Never pull an image or start Docker Desktop as a side effect of verification.
  $null = & $dockerPath version --format '{{.Server.Version}}'
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running or this session cannot access it. Open Docker Desktop, then retry.' }
  $null = & $dockerPath image inspect $image --format '{{.Id}}'
  if ($LASTEXITCODE -ne 0) { throw 'The required official Node image is not installed. No download was attempted. Arrange a trusted image before retrying.' }
  $containerName = 'seneschal-private-check-' + [Guid]::NewGuid().ToString('N')
  $initialHashes = @{}
  $arguments = @('create', '--pull=never', '--name', $containerName, '--label', 'seneschal.private-check=true', '--user=65534:65534', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--memory-swap=256m', '--cpus=1', '--pids-limit=64', '--ulimit', 'nofile=64:64', '--ulimit', 'fsize=1048576:1048576', '--log-driver=none', '--tmpfs', '/scratch:rw,noexec,nosuid,nodev,size=16m,mode=1777', '--workdir', '/scratch')
  foreach ($name in $sourceFiles) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $repoDirectory $name))
    Assert-RegularFile $absolute
    $initialHashes[$name] = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
    $arguments += @('--mount', "type=bind,source=$absolute,target=/code/$name,readonly")
  }
  # Only these new files are mounted. No real data, project folder, credentials, or Docker socket.
  # PID 1 is a trusted image watchdog: its exit tears down the entire process namespace.
  $arguments += @('--entrypoint=/usr/bin/timeout', $image, '--signal=KILL', '55s', 'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/scratch', 'TMPDIR=/scratch', 'XDG_CACHE_HOME=/scratch', 'node', '--test', '/code/tests/private-access.test.js', '/code/tests/moli.test.js', '/code/tests/questions.test.js', '/code/tests/activity-startup.test.js', '/code/tests/backups.test.js', '/code/tests/nvidia-speech.test.js', '/code/tests/ares.test.js', '/code/tests/wallpapers-host.test.js', '/code/tests/original-motion-controls.test.js')
  $created = & $dockerPath @arguments
  if ($LASTEXITCODE -ne 0 -or $created -notmatch '^[a-f0-9]{64}$') { throw 'Isolated fixture container could not be created.' }
  $containerId = $created.Trim()
  $priorProofPath = Join-Path $repoDirectory 'data/private-access-qualification.json'
  if (Test-Path -LiteralPath $priorProofPath) {
    Assert-RegularFile $priorProofPath
    if ((Get-Item -LiteralPath (Split-Path $priorProofPath -Parent)).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Qualification output directory cannot be a link.' }
    $proofBackupPath = $priorProofPath + '.before-' + [Guid]::NewGuid().ToString('N')
    Move-Item -LiteralPath $priorProofPath -Destination $proofBackupPath
    Write-Host 'Previous qualification retained as a local .before-* backup; this run must pass to qualify access again.'
  }
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $dockerPath
  $info.Arguments = 'start --attach ' + $containerId
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $clientProcess = New-Object Diagnostics.Process
  $clientProcess.StartInfo = $info
  $null = $clientProcess.Start()
  $outBuffer = New-Object char[] 4096
  $errBuffer = New-Object char[] 4096
  $outTask = $clientProcess.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length)
  $errTask = $clientProcess.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length)
  $output = New-Object Text.StringBuilder
  $watch = [Diagnostics.Stopwatch]::StartNew()
  while ($null -ne $outTask -or $null -ne $errTask -or -not $clientProcess.HasExited) {
    if ($watch.ElapsedMilliseconds -gt 60000) { throw 'Fixture verification exceeded its 60-second limit.' }
    if ($null -ne $outTask -and $outTask.IsCompleted) {
      $count = $outTask.GetAwaiter().GetResult()
      if ($count -eq 0) { $outTask = $null } else { $null = $output.Append($outBuffer, 0, $count); $outTask = $clientProcess.StandardOutput.ReadAsync($outBuffer, 0, $outBuffer.Length) }
    }
    if ($null -ne $errTask -and $errTask.IsCompleted) {
      $count = $errTask.GetAwaiter().GetResult()
      if ($count -eq 0) { $errTask = $null } else { $null = $output.Append($errBuffer, 0, $count); $errTask = $clientProcess.StandardError.ReadAsync($errBuffer, 0, $errBuffer.Length) }
    }
    if ($output.Length -gt 65536) { throw 'Fixture output exceeded its 64 KiB limit.' }
    Start-Sleep -Milliseconds 50
  }
  $clientProcess.WaitForExit()
  $containerExit = & $dockerPath inspect --format '{{.State.ExitCode}}' $containerId
  if ($LASTEXITCODE -ne 0 -or $clientProcess.ExitCode -ne 0 -or $containerExit -ne '0' -or $output.ToString() -notmatch '# fail 0') { Write-Host $output.ToString(); throw 'Fixture checks failed. Private access remains unqualified.' }
  $hashes = @{}
  foreach ($name in $sourceFiles) {
    $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $repoDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hashes[$name] -ne $initialHashes[$name]) { throw 'Source changed during verification. No qualification record was written; retry on stable files.' }
  }
  $dataDirectory = Join-Path $repoDirectory 'data'
  if (-not (Test-Path -LiteralPath $dataDirectory)) { $null = New-Item -ItemType Directory -Path $dataDirectory }
  if ((Get-Item -LiteralPath $dataDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Qualification output directory cannot be a link.' }
  $proofPath = Join-Path $dataDirectory 'private-access-qualification.json'
  if (Test-Path -LiteralPath $proofPath) { Assert-RegularFile $proofPath }
  $proof = @{ version = 1; result = 'passed'; environment = 'docker-network-none-readonly'; checkedAt = [DateTime]::UtcNow.ToString('o'); hashes = $hashes }
  [IO.File]::WriteAllText($proofPath, ($proof | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
  Write-Host $output.ToString()
  Write-Host 'Synthetic checks passed. This does not claim actual phone, voice, engine-approval or recovery qualification.'
} finally {
  if ($containerId) { $null = & $dockerPath rm --force $containerId }
  if ($clientProcess) { if (-not $clientProcess.HasExited) { $clientProcess.Kill() }; $clientProcess.Dispose() }
}
