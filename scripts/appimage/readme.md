# Void Linux AppImage Creation Script

This script automates the process of creating an AppImage for a Void Linux application using Docker. It works on macOS and Linux platforms and is designed for developers looking to package their Void Linux application as an AppImage for easy distribution.

## Requirements

*   **Docker:** The script relies on Docker to build the AppImage inside a container.
*   **macOS or Linux:** The script is designed for these platforms. On macOS, it generates a Linux-compatible AppImage.
*   **Internet Connection:** Required for downloading necessary tools (like `docker-buildx` and `appimagetool` inside the Docker container).

## Prerequisites

1.  **Install Docker:**

    *   **macOS:** Download and install Docker Desktop from [docker.com](docker.com).
    *   **Ubuntu:**
        ```bash
        sudo apt install docker.io
        ```
    *   **Arch Linux:**
        ```bash
        sudo pacman -S docker
        ```
    *   **Fedora:**
        ```bash
        sudo dnf install docker
        ```

2.  **Set Docker User Group:**

    Docker requires users to be part of the `docker` group to run Docker commands without `sudo`.

    ```bash
    sudo usermod -aG docker $USER
    ```

    After running this command, log out and log back in for the group changes to take effect.

3.  **Enable and Start Docker:**

    ```bash
    sudo systemctl enable docker
    sudo systemctl start docker
    ```

## Ubuntu Dependencies (Installed via Docker)

These dependencies are installed within the Docker container (Ubuntu 20.04 base). You generally don't need to install them manually:

*   `libfuse2`
*   `libglib2.0-0`
*   `libgtk-3-0`
*   `libx11-xcb1`
*   `libxss1`
*   `libxtst6`
*   `libnss3`
*   `libasound2`
*   `libdrm2`
*   `libgbm1`

## Usage Instructions

1.  **Clone or Download the Script:**

    Save the script to your system as `create_appimage.sh`.

2.  **Make the Script Executable:**

    ```bash
    chmod +x create_appimage.sh
    ```

3.  **Copy Required Files:**

    Copy the following files to the directory where the app binary is being bundled (created during the build process):

    *   `create_appimage.sh`
    *   `void.desktop`
    *   `void.png`

4.  **Run the Script:**

    ```bash
    ./create_appimage.sh
    ```

5.  **Result:**

    After the script completes, it will generate an AppImage named `Void-x86_64.AppImage` (or similar, depending on your architecture) in the current directory.

## Script Overview

*   **Platform Check:** Checks for macOS or Linux. Exits if unsupported.
*   **Docker Checks:** Ensures Docker is installed and running.
*   **Buildx Installation:** Installs `docker buildx` if missing.
*   **`appimagetool` Download:** Downloads `appimagetool` inside the Docker container.
*   **Dockerfile Creation:** Creates a temporary `Dockerfile.build` for the Ubuntu-based environment.
*   **Docker Image Build:** Builds a Docker image and runs the build process.
*   **AppImage Creation:**
    *   Creates the `VoidApp.AppDir` structure.
    *   Copies binaries, resources, and the `.desktop` entry.
    *   Copies `void.desktop` and `void.png`.
    *   Strips unnecessary symbols from the binary.
    *   Runs `appimagetool` to generate the AppImage.
*   **Cleanup:** Removes the temporary `Dockerfile.build`.

## Troubleshooting

*   **Docker Not Running:** Ensure Docker is installed and running.
*   **Permission Issues:** Try running the script with `sudo` or check Docker permissions.
*   **Outdated Dependencies:** Ensure you have the minimum required versions.

## License

This script is provided "as is". It is free to use, modify, and distribute, but comes with no warranty.
