# Clarity Code Windows Installer
# Installs clarity-code CLI on Windows systems
# Requires Node.js >= 22 and npm

param(
    [string]$Version = "latest",
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[clarity] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[clarity] $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "[clarity] $Message" -ForegroundColor Green
}

function Get-NodeVersion {
    try {
        $version = node --version 2>$null
        if ($version) {
            $version -replace 'v', ''
        } else {
            $null
        }
    } catch {
        $null
    }
}

function Test-NodeInstalled {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        return $false
    }
    return $true
}

function Test-NodeVersion {
    $version = Get-NodeVersion
    if (-not $version) {
        return $false
    }
    
    $major = [int]($version -split '\.')[0]
    if ($major -ge 22) {
        return $true
    }
    return $false
}

function Test-NpmInstalled {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        return $false
    }
    return $true
}

# Main installation flow
Write-Host ""
Write-Step "Clarity Code Installer for Windows"
Write-Host ""

# Check Node.js installation
if (-not $SkipNodeCheck) {
    if (-not (Test-NodeInstalled)) {
        Write-Warn "Node.js is not installed or not in PATH"
        Write-Host "Please install Node.js >= 22 from https://nodejs.org"
        exit 1
    }

    if (-not (Test-NodeVersion)) {
        Write-Warn "Node.js version is below 22"
        Write-Host "Current version: $(Get-NodeVersion)"
        Write-Host "Please upgrade to Node.js >= 22 from https://nodejs.org"
        exit 1
    }

    Write-Success "Node.js $(Get-NodeVersion) detected"
}

# Check npm installation
if (-not (Test-NpmInstalled)) {
    Write-Warn "npm is not installed or not in PATH"
    exit 1
}

Write-Success "npm detected"

# Determine installation method
# Method 1: Use npm install (primary)
Write-Step "Installing clarity-code via npm..."
npm install -g clarity-code

if ($LASTEXITCODE -eq 0) {
    Write-Success "Installation complete!"
    Write-Host ""
    Write-Host "Run 'clarity' to start Clarity Code CLI"
    Write-Host "Run 'clarity --help' for usage information"
    exit 0
}

# Fallback: Direct download from GitHub Releases
Write-Warn "npm install failed, attempting direct download..."

# Get latest release info from GitHub
$repo = "clarity-code/clarity-code"
$apiUrl = "https://api.github.com/repos/$repo/releases/$Version"

try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "ClarityCode-Installer" }
    
    # Find Windows x64 asset
    $asset = $release.assets | Where-Object { $_.name -match "win-x64.*\.zip" } | Select-Object -First 1
    
    if (-not $asset) {
        Write-Warn "No Windows x64 release found"
        exit 1
    }

    Write-Step "Downloading clarity-code $($release.tag_name)..."
    
    $tempDir = [System.IO.Path]::GetTempPath()
    $downloadPath = Join-Path $tempDir $asset.name
    
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath -Headers @{ "User-Agent" = "ClarityCode-Installer" }
    
    Write-Step "Extracting..."
    $extractDir = Join-Path $tempDir "clarity-code-install"
    
    if (Test-Path $extractDir) {
        Remove-Item $extractDir -Recurse -Force
    }
    
    Expand-Archive -Path $downloadPath -DestinationPath $extractDir -Force
    
    # Find the bin directory
    $binDir = Get-ChildItem -Path $extractDir -Directory -Recurse | Where-Object { $_.Name -eq "bin" } | Select-Object -First 1
    
    if ($binDir) {
        $targetDir = "$env:LOCALAPPDATA\clarity-code\bin"
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        
        Copy-Item -Path (Join-Path $binDir.FullName "*") -Destination $targetDir -Force
        
        # Add to PATH
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentPath -notlike "*$targetDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$currentPath;$targetDir", "User")
            Write-Success "Added $targetDir to PATH"
        }
        
        Write-Success "Installation complete!"
        Write-Host ""
        Write-Host "Run 'clarity' to start Clarity Code CLI"
    } else {
        Write-Warn "Could not find bin directory in release"
        exit 1
    }
    
    # Cleanup
    Remove-Item $downloadPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    
} catch {
    Write-Warn "Failed to download from GitHub: $_"
    Write-Host ""
    Write-Host "Alternative: Install manually using npm"
    Write-Host "  npm install -g clarity-code"
    exit 1
}