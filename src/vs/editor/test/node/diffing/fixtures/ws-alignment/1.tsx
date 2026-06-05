import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { View } from '../../layout/layout.js';

const Stack = Object.assign(
    ({ children }: { children?: ReactNode; grow?: boolean; verticalFill?: boolean }): ReactElement => (
		<div data-type='stack'>{children}</div>
	),
	{
        Item: ({ children }: { children?: ReactNode }): ReactElement => (
			<div data-type='stack-item'>{children}</div>
		)
	}
);

const Text = ({ children }: { children?: ReactNode }): ReactElement => (
	<span>{children}</span>
);

export const WelcomeView = () => {
	return (
		<View title='VS Code Tools'>
			<Stack grow={true} verticalFill={true}>
				<Stack.Item>
					<Text>
						Welcome to the VS Code Tools application.
					</Text>
				</Stack.Item>
			</Stack>
		</View>
	);
}
