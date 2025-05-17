import { VoidSwitch } from '../util/inputs.js';
import { MCPConfigParseError, MCPServerEventParam, MCPServerObject, MCPServers } from '../../../../common/mcpServiceTypes.js';
import { useEffect, useState } from 'react';
import { useAccessor } from '../util/services.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';

export interface Tool {
  /** Unique tool identifier */
  name: string;
  /** Human‑readable description */
  description?: string;
  /** JSON schema describing expected arguments */
  inputSchema?: any;
  /** Free‑form annotations describing behaviour, security, etc. */
  annotations?: Record<string, unknown>;
}

// Command display component
const CommandDisplay = ({ command }: {command: string}) => {
  return (
    <div className="px-2 py-1 bg-void-bg-3 text-xs font-mono overflow-x-auto whitespace-nowrap">
      {command}
    </div>
  );
};


interface MCPServerProps {
  name: string;
  server: MCPServerObject;
}

// MCP Server component
const MCPServer = ({ name, server }: MCPServerProps) => {

	return (
		<div className="border-b border-gray-800 bg-gray-300/10 py-4 rounded-lg ">
		<div className="flex items-center mx-4">
			{/* Status indicator */}
			<div className={`w-2 h-2 rounded-full mr-2 ${server.status === 'success' ? 'bg-green-500' : server.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`}></div>

			{/* Server name */}
			<div className="text-sm font-medium mr-2">{name}</div>

			{/* Power toggle switch */}
			<div className="ml-auto">
				<VoidSwitch
					value={server.isOn}
					disabled={server.status === 'error'}
					onChange={() => {
					server.isOn = !server.isOn;
					}}
				/>
			</div>
		</div>

		{/* Tools section */}
		<div className="mt-1 mx-4">
			<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pb-1">
			{server.tools.length > 0 ? (
				server.tools.map((tool) => (
				<span
					key={tool.name}
					className="px-2 py-0.5 bg-black/5 dark:bg-white/5 rounded text-xs"
					title={tool.description || ''}
				>
					{tool.name}
				</span>
				))
			) : (
				<span className="text-xs text-gray-500">No tools available</span>
			)}
			</div>
		</div>

		{/* Command display */}
		{server.command && (
			<div className="mt-2 mx-4">
			<div className="text-xs text-gray-400">Command:</div>
				<CommandDisplay command={server.command} />
			</div>
		)}

		{/* Error message if present */}
		{server.error && (
		<div className="mt-2 ml-4 text-red-500 flex items-center">
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
			<circle cx="12" cy="12" r="10"></circle>
			<line x1="12" y1="8" x2="12" y2="12"></line>
			<line x1="12" y1="16" x2="12.01" y2="16"></line>
			</svg>
			{server.error}
		</div>
	)}
    </div>
  );
};

// Main component that renders the list of servers
const MCPServersList = () => {

	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');
	const [mcpServers, setMCPServers] = useState<MCPServers>({});
	const [mcpConfigError, setMCPConfigError] = useState<string | null>(null);

	// Get all servers from MCPConfigService
	useEffect(() => {
		console.log('RUNNING MCPServersList EFFECT');
		// Initial fetch
		const servers = mcpService.getMCPServers();
		if (servers) {
			// Do something with the servers
			console.log('MCP Servers:', servers);
			setMCPServers(servers);
		}

		// Set up listeners for server events
		const disposables: IDisposable[] = []
		disposables.push(mcpService.onDidAddServer(handleListeners));
		disposables.push(mcpService.onDidDeleteServer(handleListeners));
		disposables.push(mcpService.onDidUpdateServer(handleListeners));
		disposables.push(mcpService.onLoadingServers(handleListeners));
		disposables.push(mcpService.onConfigParsingError(handleListeners));

		// Clean up subscription when component unmounts
		return () => {
			console.log('Cleaning up subscriptions');
			disposables.forEach(disposable => disposable.dispose());
		};

	}, [mcpService]);

	const handleListeners = (e: MCPServerEventParam | MCPConfigParseError) => {
		if (e.response.event === 'config-error') {
			// Handle the config error event
			const { error } = e.response;
			setMCPConfigError(error);
			return;
		}
		if (e.response.event === 'add' || e.response.event === 'update' || e.response.event === 'loading') {
			// Handle the add event
			const { name, newServer } = e.response;
			setMCPServers(prevServers => ({
				...prevServers,
				[name]: newServer
			}));
			return;
		}
		if (e.response.event === 'delete') {
			// Handle the delete event
			const { name, prevServer } = e.response;
			setMCPServers(prevServers => {
				const newServers = { ...prevServers };
				delete newServers[name];
				return newServers;
			});
			return;
		}
		throw new Error('Event not handled');
	}

	return (
		<div className="text-white rounded-md py-4">
		<div>
			{!mcpConfigError && Object.entries(mcpServers).map(([name, server]) => (
			<div className="py-2" key={name}>
				<MCPServer name={name} server={server} />
			</div>
			))}
			{mcpConfigError && (
			<div className="text-red-500 text-sm font-medium">
				{mcpConfigError}
			</div>
			)}
		</div>
		</div>
	);
};

export default MCPServersList;
