import { VoidSwitch, VoidButtonBgDarken } from '../util/inputs.js';
import { MCPConfigFileParseErrorResponse, MCPServerEventType, MCPServerEventResponse, MCPServerObject, MCPServerOfName } from '../../../../common/mcpServiceTypes.js';
import { useEffect, useState } from 'react';
import { useAccessor, useMCPServiceState } from '../util/services.js';


// MCP Server component
const MCPServer = ({ name, server }: { name: string, server: MCPServerObject }) => {

	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	const handleChangeEvent = (e: boolean) => {
		// Handle the change event
		mcpService.toggleMCPServer(name, e);
	}

	return (
		<div className="border-b border-gray-800 bg-gray-300/10 py-4 rounded-lg ">
			<div className="flex items-center mx-4">
				{/* Status indicator */}
				<div className={`w-2 h-2 rounded-full mr-2
					${server.status === 'success' ? 'green-500'
						: server.status === 'error' ? 'red-500'
							: server.status === 'loading' ? 'yellow-500'
								: server.status === 'offline' ? 'gray-500'
									: ''}

				  `}></div>

				{/* Server name */}
				<div className="text-sm font-medium mr-2">{name}</div>

				{/* Power toggle switch */}
				<div className="ml-auto">
					<VoidSwitch
						value={server.isOn ?? false}
						disabled={server.status === 'error'}
						onChange={handleChangeEvent}
					/>
				</div>
			</div>

			{/* Tools section */}
			<div className="mt-1 mx-4">
				<div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pb-1">
					{server.isOn && server.tools.length > 0 ? (
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

			{/* Command badge */}
			{server.isOn && server.command && (
				<div className="mt-2 mx-4">
					<div className="text-xs text-gray-400">Command:</div>
					<div className="px-2 py-1 bg-void-bg-3 text-xs font-mono overflow-x-auto whitespace-nowrap">
						{server.command}
					</div>
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

	const mcpServiceState = useMCPServiceState()
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');

	return (
		<div className="text-white rounded-md py-4">
			<div>
				{!mcpServiceState.error && Object.entries(mcpServiceState.mcpServerOfName).map(([name, server]) => (
					<div className="py-2" key={name}>
						<MCPServer name={name} server={server} />
					</div>
				))}
				{mcpServiceState.error && (
					<div className="text-red-500 text-sm font-medium">
						{mcpServiceState.error}
					</div>
				)}
			</div>
		</div>
	);
};

export default MCPServersList;
