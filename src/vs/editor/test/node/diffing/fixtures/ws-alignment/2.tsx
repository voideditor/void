import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { View } from '../../layout/layout.js';

const Nav = ({
	groups
}: {
    groups: { links: { name: string; url: string; icon: string; target: string }[] }[];
}): ReactElement => (
	<nav data-type='nav'>
		{groups.map((group, idx) => (
			<ul key={idx}>
				{group.links.map((link) => (
					<li key={link.url}>
						<a href={link.url} target={link.target} rel='noreferrer'>
							{link.name} ({link.icon})
						</a>
					</li>
				))}
			</ul>
		))}
	</nav>
);

export const WelcomeView = () => {
	return (
		<View title='VS Code Tools'>
			<Nav
				groups={[
					{
						links: [
							{ name: 'VS Code Standup (Redmond)', url: 'https://vscode-standup.azurewebsites.net', icon: 'JoinOnlineMeeting', target: '_blank' },
							{ name: 'VS Code Standup (Zurich)', url: 'https://stand.azurewebsites.net/', icon: 'JoinOnlineMeeting', target: '_blank' },
							{ name: 'VS Code Errors', url: 'https://errors.code.visualstudio.com', icon: 'ErrorBadge', target: '_blank' },
						]
					}
				]}>
			</Nav>
		</View>
	);
}
