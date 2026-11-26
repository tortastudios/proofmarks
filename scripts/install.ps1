# Installs the standalone Proofmarks program on Windows, no Node needed:
#
#   irm https://github.com/tortastudios/proofmarks/releases/latest/download/install.ps1 | iex
#
# $env:PROOFMARKS_VERSION        a version such as 0.2.0 (default: the latest release)
# $env:PROOFMARKS_HOME           where it goes (default: %LOCALAPPDATA%\Proofmarks); its bin folder is added to your PATH
# $env:PROOFMARKS_DOWNLOAD_BASE  where the release files are (default: the GitHub release for that version)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 can default to older TLS versions, which GitHub refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$repo = 'tortastudios/proofmarks'
function Stop-Install([string]$message) { Write-Host "Proofmarks: $message" -ForegroundColor Red; exit 1 }

if (-not [Environment]::Is64BitOperatingSystem) { Stop-Install 'there is no standalone build for 32-bit Windows.' }
# There is one Windows build, for x64; Windows on Arm runs it under emulation.
$version = $env:PROOFMARKS_VERSION
if (-not $version) {
  try { $version = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing).tag_name }
  catch { Stop-Install "couldn't find the latest release; set PROOFMARKS_VERSION." }
}
$version = $version.TrimStart('v')
$name = "proofmarks-$version-win-x64"
$base = if ($env:PROOFMARKS_DOWNLOAD_BASE) { $env:PROOFMARKS_DOWNLOAD_BASE.TrimEnd('/') } else { "https://github.com/$repo/releases/download/v$version" }
$installHome = if ($env:PROOFMARKS_HOME) { $env:PROOFMARKS_HOME } else { Join-Path $env:LOCALAPPDATA 'Proofmarks' }

$work = Join-Path ([IO.Path]::GetTempPath()) ("proofmarks-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Write-Host "Downloading Proofmarks $version for win-x64"
  $zip = Join-Path $work "$name.zip"
  $sum = Join-Path $work "$name.zip.sha256"
  try {
    Invoke-WebRequest "$base/$name.zip" -OutFile $zip -UseBasicParsing
    Invoke-WebRequest "$base/$name.zip.sha256" -OutFile $sum -UseBasicParsing
  } catch { Stop-Install "couldn't download $base/$name.zip" }
  $expected = ((Get-Content $sum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { Stop-Install "the download doesn't match its checksum." }

  $versions = Join-Path $installHome 'versions'
  $bin = Join-Path $installHome 'bin'
  New-Item -ItemType Directory -Force -Path $versions, $bin | Out-Null
  $launcher = Join-Path $bin 'proofmarks.cmd'
  # The version in use now, if any, from the program the launcher calls (...\versions\<name>\dist\companion\proofmarks.exe).
  $previous = if ((Test-Path $launcher) -and ((Get-Content $launcher -Raw) -match 'versions[\\/]([^\\/]+)[\\/]dist')) { $Matches[1] } else { '' }
  $target = Join-Path $versions $name
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Expand-Archive $zip -DestinationPath $versions -Force
  $program = Join-Path $target 'dist\companion\proofmarks.exe'
  # Only switch to the new version once it starts; a broken download leaves the old one in place.
  $started = $false
  try { & $program --help *> $null; $started = $LASTEXITCODE -eq 0 } catch { }
  if (-not $started) {
    if ($previous -ne $name) { Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue }
    Stop-Install "the downloaded program didn't start."
  }
  Set-Content -Path $launcher -Value "@`"$program`" %*" -Encoding ASCII
  # Keep this version and the one before it (a helper may still be running from it); remove older ones.
  Get-ChildItem $versions -Directory -Filter 'proofmarks-*' | Where-Object { $_.Name -ne $name -and $_.Name -ne $previous } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $bin)) {
    [Environment]::SetEnvironmentVariable('Path', (@($bin) + ($userPath -split ';' | Where-Object { $_ })) -join ';', 'User')
    Write-Host "Added $bin to your PATH. Open a new terminal to use it."
  }
  Write-Host "Installed Proofmarks $version`: $bin\proofmarks.cmd"
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
