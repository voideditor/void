#!/usr/bin/env bash

set -e # Exit on error

# Usage: sign.sh {sign|notarize} {arm64|x64}




echo "-------------------- Setting local variables... --------------------"
ARCH=$2


# Required variables:
# ORIGINAL_DOTAPP_DIR="${HOME}/Desktop/VSCode-darwin-${ARCH}" # location of original (nothing is modified in this dir, just copied away from it)
# WORKING_DIR="${HOME}/Desktop/VoidSign-${ARCH}" # temp dir for all the work here
# P12_FILE="${HOME}/Desktop/sign/cert.p12"
# P12_PASSWORD="..."
# APPLE_ID="..."
# TEAM_ID="..."
# APP_PASSWORD="..." # see https://appleid.apple.com
# CODESIGN_IDENTITY="Developer ID Application: ..." # try `security find-identity -v -p codesigning`



## computed
KEYCHAIN_DIR="${WORKING_DIR}/1_Keychain"
KEYCHAIN="${KEYCHAIN_DIR}/buildagent.keychain"

SIGN_DIR="${WORKING_DIR}/2_Signed"
SIGNED_DOTAPP_DIR="${SIGN_DIR}/VSCode-darwin-${ARCH}"
SIGNED_DOTAPP="${SIGN_DIR}/VSCode-darwin-${ARCH}/Void.app"

SIGNED_DMG_DIR="${SIGN_DIR}/VSCode-darwin-${ARCH}"
SIGNED_DMG="${SIGN_DIR}/VSCode-darwin-${ARCH}/Void-Installer-darwin-${ARCH}.dmg"

echo $KEYCHAIN_DIR




sign() {

    echo "-------------------- 0. cleanup + copy --------------------"
    rm -rf "${WORKING_DIR}"

    mkdir "${WORKING_DIR}"
    mkdir "${KEYCHAIN_DIR}"
    mkdir "${SIGN_DIR}"

    cp -Rp $ORIGINAL_DOTAPP_DIR $SIGN_DIR


    echo "-------------------- 1. Make temp keychain --------------------"
    # Create a new keychain
    security create-keychain -p pwd "${KEYCHAIN}"
    security set-keychain-settings -lut 21600 "${KEYCHAIN}"
    security unlock-keychain -p pwd "${KEYCHAIN}"


    # Import your p12 certificate
    security import "${P12_FILE}" -k "${KEYCHAIN}" -P "${P12_PASSWORD}" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k pwd "${KEYCHAIN}" > /dev/null


    echo "-------------------- 2a. Sign --------------------"
    cd "${HOME}/Desktop/void/build/darwin"

    # used in sign.js
    export AGENT_TEMPDIRECTORY=$KEYCHAIN_DIR
    export CODESIGN_IDENTITY="${CODESIGN_IDENTITY}"
    export VSCODE_ARCH=$ARCH
    node sign.js "${SIGN_DIR}"
    codesign --verify --verbose=4 "${SIGNED_DOTAPP}"

    echo "-------------------- 2b. Make into dmg --------------------"
    npx create-dmg --volname "Void Installer" "${SIGNED_DOTAPP}" "${SIGNED_DMG_DIR}"
    # there are two create-dmgs https://github.com/create-dmg/create-dmg https://github.com/sindresorhus/create-dmg the latter one is on npm and works better
    GENERATED_DMG=$(ls "${SIGNED_DMG_DIR}"/*.dmg) # figure out the full path of the generated file because create-dmg is stupid
    if [[ -z "$GENERATED_DMG" ]]; then
        echo "Error: No .dmg file was created."
        exit 1
    fi
    mv "${GENERATED_DMG}" "${SIGNED_DMG}" # rename

    # We don't even have to codesign - apparently create-dmg does it! codesign --deep --options runtime --sign "${CODESIGN_IDENTITY}" "${SIGNED_DMG}" create
    codesign --verify --verbose=4 "${SIGNED_DMG}"

}


# notarize DMG
notarize(){

    KEYCHAIN_PROFILE_NAME="Void" # this doesnt seem to do anything but is required

    # echo "-------------------- 4. Notarize --------------------"
    # echo "Past history:"
    # xcrun notarytool history --keychain-profile "${KEYCHAIN_PROFILE_NAME}" --keychain "${KEYCHAIN}"
    echo "Void: Setting credentials..."
    xcrun notarytool store-credentials "${KEYCHAIN_PROFILE_NAME}" \
    --apple-id "${APPLE_ID}" \
    --team-id "${TEAM_ID}" \
    --password "${APP_PASSWORD}" \
    --keychain "${KEYCHAIN}"

    echo "Void: Submitting..."
    xcrun notarytool submit "${SIGNED_DMG}" \
    --keychain-profile "${KEYCHAIN_PROFILE_NAME}" \
    --keychain "${KEYCHAIN}" \
    --wait

    echo "Done! Stapling..."
    # finds notarized ticket that was made and staples it to Void.app
    xcrun stapler staple "${SIGNED_DMG}"

    # echo "-------------------- 6. Verify --------------------"
    # spctl --assess --verbose=4 "${SIGNED_DMG}"

}


updater(){
	cd "${SIGNED_DOTAPP_DIR}"
	echo "Zipping updater here..."
	VOIDAPP=$(basename $SIGNED_DOTAPP)
	zip -r -q "Void-Updater-darwin-${ARCH}.zip" "${VOIDAPP}"

	echo "Done!"
}

USAGE="Usage: $0 {sign|notarize|updater} {arm64|x64}"

# check to make sure arm64 or x64 is specified
case "$2" in
    arm64)
        ;;
    x64)
        ;;
    *)
        echo $USAGE
        exit 1
        ;;
esac

# Check the first argument
case "$1" in
    sign)
        sign
        ;;
    notarize)
        notarize
        ;;
	updater)
		updater
		;;
    *)
        echo $USAGE
        exit 1
        ;;
esac
