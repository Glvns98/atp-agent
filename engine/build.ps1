$ErrorActionPreference = "Stop"

Write-Host "Building ATP Engine for multiple platforms..."

Write-Host "Generating SBOM..."
python ..\scripts\generate_sbom.py

# Create dist directory
New-Item -ItemType Directory -Force -Path "dist" | Out-Null

$Targets = @(
    @{ OS = "windows"; Arch = "amd64"; Ext = ".exe" },
    @{ OS = "linux"; Arch = "amd64"; Ext = "" },
    @{ OS = "darwin"; Arch = "amd64"; Ext = "" },
    @{ OS = "darwin"; Arch = "arm64"; Ext = "" }
)

foreach ($target in $Targets) {
    $os = $target.OS
    $arch = $target.Arch
    $ext = $target.Ext
    
    $binName = "atp-engine-$os-$arch$ext"
    $outPath = "dist/$binName"
    
    Write-Host "Building $os/$arch -> $outPath"
    
    $env:GOOS = $os
    $env:GOARCH = $arch
    
    # We disable CGO to ensure it builds a completely standalone static binary that runs anywhere
    $env:CGO_ENABLED = "0"
    
    go build -o $outPath main.go
}

Write-Host "Build complete! Upload these binaries to GitHub Releases."
