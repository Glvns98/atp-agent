$ErrorActionPreference = "Stop"

Write-Host "--- Starting ATP Universal Build & Packaging ---"

# Root setup
$RootDir = Get-Location
$ReleaseDir = Join-Path $RootDir "release"

if (Test-Path $ReleaseDir) {
    Remove-Item -Recurse -Force $ReleaseDir
}
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
New-Item -ItemType Directory -Force -Path "$ReleaseDir/engine" | Out-Null
New-Item -ItemType Directory -Force -Path "$ReleaseDir/python" | Out-Null
New-Item -ItemType Directory -Force -Path "$ReleaseDir/node" | Out-Null
New-Item -ItemType Directory -Force -Path "$ReleaseDir/portal" | Out-Null

# 1. Build Engine
Write-Host "`n[1/4] Compiling Go Engine..."
Set-Location "$RootDir/engine"
./build.ps1
Move-Item -Path "dist/*" -Destination "$ReleaseDir/engine/" -Force

# 2. Package Python SDK
Write-Host "`n[2/4] Packaging Python SDK..."
Set-Location "$RootDir/sdk/python"
python setup.py sdist bdist_wheel
Move-Item -Path "dist/*" -Destination "$ReleaseDir/python/" -Force

# 3. Package Node SDK
Write-Host "`n[3/4] Packaging Node SDK..."
Set-Location "$RootDir/sdk/node"
npm pack --pack-destination "$ReleaseDir/node/"

# 4. Package Portal
Write-Host "`n[4/4] Building and Packaging Enterprise Portal..."
Set-Location "$RootDir/platform"
npm install
npm run build
npm pack --pack-destination "$ReleaseDir/portal/"

Set-Location $RootDir
Write-Host "`n--- Build Complete! ---"
Write-Host "All artifacts have been moved to the ./release/ directory."
