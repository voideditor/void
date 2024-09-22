# Build Script for Contributing to Void

# Function to display welcome message
function Show-Welcome {
    Write-Host "Welcome to Void! 👋" -ForegroundColor Cyan
    Write-Host "This is a guide on how to contribute to Void."
    Write-Host "For questions, reach out via email or Discord!"
}

# Function to clone the repository
function Clone-Repository {
    Write-Host "Cloning the repository..."
    git clone https://github.com/voideditor/void
}

# Function to open the extension folder in VS Code
function Open-VSCode {
    Write-Host "Opening /extensions/void in VS Code..."
    code ./extensions/void
}

# Function to install dependencies
function Install-Dependencies {
    Write-Host "Installing dependencies..."
    npm install
}

# Function to build the project
function Build-Project {
    Write-Host "Building the project..."
    npm run build
}

# Function to run the project
function Run-Project {
    Write-Host "Running the project. Press F5 to start..."
    Write-Host "If that doesn't work, use Ctrl+Shift+P and select 'Debug: Start Debugging'."
}

# Function to set up AI features
function Setup-AIFeatures {
    Write-Host "To use AI features, set your API key in Settings (Ctrl+,)."
    Write-Host "Add the key to the 'Anthropic Api Key' environment variable."
}

# Function for building the full IDE
function Build-FullIDE {
    Write-Host "Building the full IDE..."
    Write-Host "Make sure you've built the extension first (cd ./extensions/void and npm run build)."
    Write-Host "Installing all dependencies..."
    yarn
    Write-Host "Press Ctrl+Shift+B in VS Code to start the build process or run npm run watch."
    Write-Host "To open the built IDE, run ./scripts/code.sh."
}

# Main script execution
Show-Welcome
Clone-Repository
Open-VSCode
Install-Dependencies
Build-Project
Run-Project
Setup-AIFeatures
Build-FullIDE

Write-Host "Now you're set up to contribute! Check out the Issues page for more information."
