/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import Log from './common/logger';
import { getVSCodeServerConfig } from './serverConfig';
import { WSLManager } from './wsl/wslManager';

export interface ServerInstallOptions {
	id: string;
	quality: string;
	commit: string;
	version: string;
	release?: string; // void specific
	extensionIds: string[];
	envVariables: string[];
	serverApplicationName: string;
	serverDataFolderName: string;
	serverDownloadUrlTemplate: string;
}

export interface ServerInstallResult {
	exitCode: number;
	listeningOn: number;
	connectionToken: string;
	logFile: string;
	osReleaseId: string;
	arch: string;
	platform: string;
	tmpDir: string;
	[key: string]: any;
}

export class ServerInstallError extends Error {
	constructor(message: string) {
		super(message);
	}
}

const DEFAULT_DOWNLOAD_URL_TEMPLATE = 'https://github.com/voideditor-test/binaries/releases/download/${version}.${release}/void-reh-${os}-${arch}-${version}.${release}.tar.gz';

export async function installCodeServer(wslManager: WSLManager, distroName: string, serverDownloadUrlTemplate: string | undefined, extensionIds: string[], envVariables: string[], logger: Log): Promise<ServerInstallResult> {
	const scriptId = crypto.randomBytes(12).toString('hex');

	const vscodeServerConfig = await getVSCodeServerConfig();
	const installOptions: ServerInstallOptions = {
		id: scriptId,
		version: vscodeServerConfig.version,
		commit: vscodeServerConfig.commit,
		quality: vscodeServerConfig.quality,
		release: vscodeServerConfig.release,
		extensionIds,
		envVariables,
		serverApplicationName: vscodeServerConfig.serverApplicationName,
		serverDataFolderName: vscodeServerConfig.serverDataFolderName,
		serverDownloadUrlTemplate: serverDownloadUrlTemplate ?? vscodeServerConfig.serverDownloadUrlTemplate ?? DEFAULT_DOWNLOAD_URL_TEMPLATE,
	};

	const installServerScript = generateBashInstallScript(installOptions);

	// Fish shell does not support heredoc so let's workaround it using -c option,
	// also replace single quotes (') within the script with ('\'') as there's no quoting within single quotes, see https://unix.stackexchange.com/a/24676
	const resp = await wslManager.exec('bash', ['-c', `'${installServerScript.replace(/'/g, `'\\''`)}'`], distroName);

	const endScriptRegex = new RegExp(`${scriptId}: Server installation script done`, 'm');
	const commandOutput = await Promise.race([
		resp.exitPromise.then(result => ({ stdout: resp.stdout, stderr: resp.stderr, exitCode: result.exitCode })),
		new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
			resp.onStdoutData(buffer => {
				if (endScriptRegex.test(buffer.toString('utf8'))) {
					resolve({ stdout: resp.stdout, stderr: resp.stderr, exitCode: 0 });
				}
			});
		})
	]);

	if (commandOutput.exitCode) {
		logger.trace('Server install command stderr:', commandOutput.stderr);
	}
	logger.trace('Server install command stdout:', commandOutput.stdout);

	const resultMap = parseServerInstallOutput(commandOutput.stdout, scriptId);
	if (!resultMap) {
		throw new ServerInstallError(`Failed parsing install script output`);
	}

	const exitCode = parseInt(resultMap.exitCode, 10);
	if (exitCode !== 0) {
		throw new ServerInstallError(`Couldn't install void server on remote server, install script returned non-zero exit status`);
	}

	const listeningOn = parseInt(resultMap.listeningOn, 10);

	const remoteEnvVars = Object.fromEntries(Object.entries(resultMap).filter(([key,]) => envVariables.includes(key)));

	return {
		exitCode,
		listeningOn,
		connectionToken: resultMap.connectionToken,
		logFile: resultMap.logFile,
		osReleaseId: resultMap.osReleaseId,
		arch: resultMap.arch,
		platform: resultMap.platform,
		tmpDir: resultMap.tmpDir,
		...remoteEnvVars
	};
}

function parseServerInstallOutput(str: string, scriptId: string): { [k: string]: string } | undefined {
	const startResultStr = `${scriptId}: start`;
	const endResultStr = `${scriptId}: end`;

	const startResultIdx = str.indexOf(startResultStr);
	if (startResultIdx < 0) {
		return undefined;
	}

	const endResultIdx = str.indexOf(endResultStr, startResultIdx + startResultStr.length);
	if (endResultIdx < 0) {
		return undefined;
	}

	const installResult = str.substring(startResultIdx + startResultStr.length, endResultIdx);

	const resultMap: { [k: string]: string } = {};
	const resultArr = installResult.split(/\r?\n/);
	for (const line of resultArr) {
		const [key, value] = line.split('==');
		resultMap[key] = value;
	}

	return resultMap;
}

function generateBashInstallScript({ id, quality, version, commit, release, extensionIds, envVariables, serverApplicationName, serverDataFolderName, serverDownloadUrlTemplate }: ServerInstallOptions) {
	const extensions = extensionIds.map(id => '--install-extension ' + id).join(' ');
	return `
# Server installation script

TMP_DIR="\${XDG_RUNTIME_DIR:-"/tmp"}"

DISTRO_VERSION="${version}"
DISTRO_COMMIT="${commit}"
DISTRO_QUALITY="${quality}"
DISTRO_VSCODIUM_RELEASE="${release ?? ''}"

SERVER_APP_NAME="${serverApplicationName}"
SERVER_INITIAL_EXTENSIONS="${extensions}"
SERVER_LISTEN_FLAG="--port=0"
SERVER_DATA_DIR="$HOME/${serverDataFolderName}"
SERVER_DIR="$SERVER_DATA_DIR/bin/$DISTRO_COMMIT"
SERVER_SCRIPT="$SERVER_DIR/bin/$SERVER_APP_NAME"
SERVER_LOGFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.log"
SERVER_PIDFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.pid"
SERVER_TOKENFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.token"
SERVER_OS=
SERVER_ARCH=
SERVER_CONNECTION_TOKEN=
SERVER_DOWNLOAD_URL=

LISTENING_ON=
OS_RELEASE_ID=
ARCH=
PLATFORM=

# Mimic output from logs of remote-ssh extension
print_install_results_and_exit() {
	echo "${id}: start"
	echo "exitCode==$1=="
	echo "listeningOn==$LISTENING_ON=="
	echo "connectionToken==$SERVER_CONNECTION_TOKEN=="
	echo "logFile==$SERVER_LOGFILE=="
	echo "osReleaseId==$OS_RELEASE_ID=="
	echo "arch==$ARCH=="
	echo "platform==$PLATFORM=="
	echo "tmpDir==$TMP_DIR=="
	${envVariables.map(envVar => `echo "${envVar}==$${envVar}=="`).join('\n')}
	echo "${id}: end"
	exit 0
}

# Check if platform is supported
PLATFORM="$(uname -s)"
case $PLATFORM in
	Linux)
		SERVER_OS="linux"
		;;
	*)
		echo "Error platform not supported: $PLATFORM"
		print_install_results_and_exit 1
		;;
esac

# Check machine architecture
ARCH="$(uname -m)"
case $ARCH in
	x86_64 | amd64)
		SERVER_ARCH="x64"
		;;
	armv7l | armv8l)
		SERVER_ARCH="armhf"
		;;
	arm64 | aarch64)
		SERVER_ARCH="arm64"
		;;
	*)
		echo "Error architecture not supported: $ARCH"
		print_install_results_and_exit 1
		;;
esac

# https://www.freedesktop.org/software/systemd/man/os-release.html
OS_RELEASE_ID="$(grep -i '^ID=' /etc/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
if [[ -z $OS_RELEASE_ID ]]; then
	OS_RELEASE_ID="$(grep -i '^ID=' /usr/lib/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
	if [[ -z $OS_RELEASE_ID ]]; then
		OS_RELEASE_ID="unknown"
	fi
fi

# Create installation folder
if [[ ! -d $SERVER_DIR ]]; then
	mkdir -p $SERVER_DIR
	if (( $? > 0 )); then
		echo "Error creating server install directory"
		print_install_results_and_exit 1
	fi
fi

SERVER_DOWNLOAD_URL="$(echo "${serverDownloadUrlTemplate.replace(/\$\{/g, '\\${')}" | sed "s/\\\${quality}/$DISTRO_QUALITY/g" | sed "s/\\\${version}/$DISTRO_VERSION/g" | sed "s/\\\${commit}/$DISTRO_COMMIT/g" | sed "s/\\\${os}/$SERVER_OS/g" | sed "s/\\\${arch}/$SERVER_ARCH/g" | sed "s/\\\${release}/$DISTRO_VSCODIUM_RELEASE/g")"

# Check if server script is already installed
if [[ ! -f $SERVER_SCRIPT ]]; then
	if [[ "$SERVER_OS" = "dragonfly" ]] || [[ "$SERVER_OS" = "freebsd" ]]; then
		echo "Error "$SERVER_OS" needs manual installation of remote extension host"
		print_install_results_and_exit 1
	fi

	pushd $SERVER_DIR > /dev/null

	if [[ ! -z $(which wget) ]]; then
		wget --tries=3 --timeout=10 --continue --no-verbose -O vscode-server.tar.gz $SERVER_DOWNLOAD_URL
	elif [[ ! -z $(which curl) ]]; then
		curl --retry 3 --connect-timeout 10 --location --show-error --silent --output vscode-server.tar.gz $SERVER_DOWNLOAD_URL
	else
		echo "Error no tool to download server binary"
		print_install_results_and_exit 1
	fi

	if (( $? > 0 )); then
		echo "Error downloading server from $SERVER_DOWNLOAD_URL"
		print_install_results_and_exit 1
	fi

	tar -xf vscode-server.tar.gz --strip-components 1
	if (( $? > 0 )); then
		echo "Error while extracting server contents"
		print_install_results_and_exit 1
	fi

	if [[ ! -f $SERVER_SCRIPT ]]; then
		echo "Error server contents are corrupted"
		print_install_results_and_exit 1
	fi

	rm -f vscode-server.tar.gz

	popd > /dev/null
else
	echo "Server script already installed in $SERVER_SCRIPT"
fi

# Try to find if server is already running
if [[ -f $SERVER_PIDFILE ]]; then
	SERVER_PID="$(cat $SERVER_PIDFILE)"
	SERVER_RUNNING_PROCESS="$(ps -o pid,args -p $SERVER_PID | grep $SERVER_SCRIPT)"
else
	SERVER_RUNNING_PROCESS="$(ps -o pid,args -A | grep $SERVER_SCRIPT | grep -v grep)"
fi

if [[ -z $SERVER_RUNNING_PROCESS ]]; then
	if [[ -f $SERVER_LOGFILE ]]; then
		rm $SERVER_LOGFILE
	fi
	if [[ -f $SERVER_TOKENFILE ]]; then
		rm $SERVER_TOKENFILE
	fi

	touch $SERVER_TOKENFILE
	chmod 600 $SERVER_TOKENFILE
	SERVER_CONNECTION_TOKEN="${crypto.randomUUID()}"
	echo $SERVER_CONNECTION_TOKEN > $SERVER_TOKENFILE

	$SERVER_SCRIPT --start-server --host=127.0.0.1 $SERVER_LISTEN_FLAG $SERVER_INITIAL_EXTENSIONS --connection-token-file $SERVER_TOKENFILE --telemetry-level off --use-host-proxy --disable-websocket-compression --without-browser-env-var --enable-remote-auto-shutdown --accept-server-license-terms &> $SERVER_LOGFILE &
	echo $! > $SERVER_PIDFILE
else
	echo "Server script is already running $SERVER_SCRIPT"
fi

if [[ -f $SERVER_TOKENFILE ]]; then
	SERVER_CONNECTION_TOKEN="$(cat $SERVER_TOKENFILE)"
else
	echo "Error server token file not found $SERVER_TOKENFILE"
	print_install_results_and_exit 1
fi

if [[ -f $SERVER_LOGFILE ]]; then
	for i in {1..5}; do
		LISTENING_ON="$(cat $SERVER_LOGFILE | grep -E 'Extension host agent listening on .+' | sed 's/Extension host agent listening on //')"
		if [[ -n $LISTENING_ON ]]; then
			break
		fi
		sleep 0.5
	done

	if [[ -z $LISTENING_ON ]]; then
		echo "Error server did not start sucessfully"
		print_install_results_and_exit 1
	fi
else
	echo "Error server log file not found $SERVER_LOGFILE"
	print_install_results_and_exit 1
fi

# Finish server setup and keep script running
if [[ -z $SERVER_RUNNING_PROCESS ]]; then
	echo "${id}: start"
	echo "exitCode==0=="
	echo "listeningOn==$LISTENING_ON=="
	echo "connectionToken==$SERVER_CONNECTION_TOKEN=="
	echo "logFile==$SERVER_LOGFILE=="
	echo "osReleaseId==$OS_RELEASE_ID=="
	echo "arch==$ARCH=="
	echo "platform==$PLATFORM=="
	echo "tmpDir==$TMP_DIR=="
	${envVariables.map(envVar => `echo "${envVar}==$${envVar}=="`).join('\n')}
	echo "${id}: end"

	echo "${id}: Server installation script done"

	SERVER_PID="$(cat $SERVER_PIDFILE)"
	SERVER_RUNNING_PROCESS="$(ps -o pid,args -p $SERVER_PID | grep $SERVER_SCRIPT)"
	while [[ -n $SERVER_RUNNING_PROCESS ]]; do
		sleep 300;
		SERVER_RUNNING_PROCESS="$(ps -o pid,args -p $SERVER_PID | grep $SERVER_SCRIPT)"
	done
else
	print_install_results_and_exit 0
fi
`;
}
