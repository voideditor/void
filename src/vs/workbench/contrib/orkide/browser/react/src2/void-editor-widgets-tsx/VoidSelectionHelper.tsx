/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { useAccessor, useActiveURI, useIsDark, useSettingsState } from '../util/services.js';

import '../styles.css';
import { VOID_CTRL_K_ACTION_ID, VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { Circle, MoreVertical } from 'lucide-react';
import { useEffect, useState } from 'react';

import { VoidSelectionHelperProps } from '../../../../../../contrib/void/browser/voidSelectionHelperWidget.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';


export const VoidSelectionHelperMain = (props: VoidSelectionHelperProps) => {

  const isDark = useIsDark();

  return <div
    className={`void-scope ${isDark ? "void-dark" : ""}`}>

		<VoidSelectionHelper {...props} />
	</div>;
};



const VoidSelectionHelper = ({ rerenderKey }: VoidSelectionHelperProps) => {


  const accessor = useAccessor();
  const keybindingService = accessor.get('IKeybindingService');
  const commandService = accessor.get('ICommandService');

  const ctrlLKeybind = keybindingService.lookupKeybinding(VOID_CTRL_L_ACTION_ID);
  const ctrlKKeybind = keybindingService.lookupKeybinding(VOID_CTRL_K_ACTION_ID);

  const dividerHTML = <div className="void-w-[0.5px] void-bg-void-border-3"></div>;

  const [reactRerenderCount, setReactRerenderKey] = useState(rerenderKey);
  const [clickState, setClickState] = useState<'init' | 'clickedOption' | 'clickedMore'>('init');

  useEffect(() => {
    const disposable = commandService.onWillExecuteCommand((e) => {
      if (e.commandId === VOID_CTRL_L_ACTION_ID || e.commandId === VOID_CTRL_K_ACTION_ID) {
        setClickState('clickedOption');
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [commandService, setClickState]);


  // rerender when the key changes
  if (reactRerenderCount !== rerenderKey) {
    setReactRerenderKey(rerenderKey);
    setClickState('init');
  }
  // useEffect(() => {
  // }, [rerenderKey, reactRerenderCount, setReactRerenderKey, setClickState])

  // if the user selected an option, close


  if (clickState === 'clickedOption') {
    return null;
  }

  const defaultHTML = <>
		{ctrlLKeybind &&
    <div
      className=" void-flex void-items-center void-px-2 void-py-1.5 void-cursor-pointer "



      onClick={() => {
        commandService.executeCommand(VOID_CTRL_L_ACTION_ID);
        setClickState('clickedOption');
      }}>

				<span>Add to Chat</span>
				<span className="void-ml-1 void-px-1 void-rounded void-bg-[var(--vscode-keybindingLabel-background)] void-text-[var(--vscode-keybindingLabel-foreground)] void-border void-border-[var(--vscode-keybindingLabel-border)]">
					{ctrlLKeybind.getLabel()}
				</span>
			</div>
    }
		{ctrlLKeybind && ctrlKKeybind &&
    dividerHTML
    }
		{ctrlKKeybind &&
    <div
      className=" void-flex void-items-center void-px-2 void-py-1.5 void-cursor-pointer "



      onClick={() => {
        commandService.executeCommand(VOID_CTRL_K_ACTION_ID);
        setClickState('clickedOption');
      }}>

				<span className="void-ml-1">Edit Inline</span>
				<span className="void-ml-1 void-px-1 void-rounded void-bg-[var(--vscode-keybindingLabel-background)] void-text-[var(--vscode-keybindingLabel-foreground)] void-border void-border-[var(--vscode-keybindingLabel-border)]">
					{ctrlKKeybind.getLabel()}
				</span>
			</div>
    }

		{dividerHTML}

		<div
      className=" void-flex void-items-center void-px-0.5 void-cursor-pointer "



      onClick={() => {
        setClickState('clickedMore');
      }}>

			<MoreVertical className="void-w-4" />
		</div>
	</>;


  const moreOptionsHTML = <>
		<div
      className=" void-flex void-items-center void-px-2 void-py-1.5 void-cursor-pointer "



      onClick={() => {
        commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID);
        setClickState('clickedOption');
      }}>

			Disable Suggestions?
		</div>

		{dividerHTML}

		<div
      className=" void-flex void-items-center void-px-0.5 void-cursor-pointer "



      onClick={() => {
        setClickState('init');
      }}>

			<MoreVertical className="void-w-4" />
		</div>
	</>;

  return <div className=" void-pointer-events-auto void-select-none void-z-[1000] void-rounded-sm void-shadow-md void-flex void-flex-nowrap void-text-nowrap void-border void-border-void-border-3 void-bg-void-bg-2 void-transition-all void-duration-200 ">






		{clickState === 'init' ? defaultHTML :
    clickState === 'clickedMore' ? moreOptionsHTML :
    <></>
    }
	</div>;
};