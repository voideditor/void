/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidModelInfo, globalSettingNames, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, defaultProviderSettings, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled } from '../../../../common/voidSettingsTypes.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { VoidButton, VoidCheckBox, VoidCustomDropdownBox, VoidInputBox, VoidInputBox2, VoidSwitch } from '../util/inputs.js';
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js';
import { X, RefreshCw, Loader2, Check, MoveRight } from 'lucide-react';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { isWindows, isLinux, isMacintosh } from '../../../../../../../base/common/platform.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { env } from '../../../../../../../base/common/process.js';
import { ModelDropdown } from './ModelDropdown.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { WarningBox } from './WarningBox.js';

const SubtleButton = ({ onClick, text, icon, disabled }: {onClick: () => void;text: string;icon: React.ReactNode;disabled: boolean;}) => {

  return <div className="void-flex void-items-center void-text-void-fg-3 void-mb-1 void-px-3 void-rounded-sm void-overflow-hidden void-gap-2 hover:void-bg-black/10 dark:hover:void-bg-gray-300/10">
		<button className="void-flex void-items-center" disabled={disabled} onClick={onClick}>
			{icon}
		</button>
		<span>
			{text}
		</span>
	</div>;
};

// models
const RefreshModelButton = ({ providerName }: {providerName: RefreshableProviderName;}) => {

  const refreshModelState = useRefreshModelState();

  const accessor = useAccessor();
  const refreshModelService = accessor.get('IRefreshModelService');
  const metricsService = accessor.get('IMetricsService');

  const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null);

  useRefreshModelListener(
    useCallback((providerName2, refreshModelState) => {
      if (providerName2 !== providerName) return;
      const { state } = refreshModelState[providerName];
      if (!(state === 'finished' || state === 'error')) return;
      // now we know we just entered 'finished' state for this providerName
      setJustFinished(state);
      const tid = setTimeout(() => {setJustFinished(null);}, 2000);
      return () => clearTimeout(tid);
    }, [providerName])
  );

  const { state } = refreshModelState[providerName];

  const { title: providerTitle } = displayInfoOfProviderName(providerName);
  return <SubtleButton
    onClick={() => {
      refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false });
      metricsService.capture('Click', { providerName, action: 'Refresh Models' });
    }}
    text={justFinished === 'finished' ? `${providerTitle} Models are up-to-date!` :
    justFinished === 'error' ? `${providerTitle} not found!` :
    `Manually refresh ${providerTitle} models.`
    }
    icon={justFinished === 'finished' ? <Check className="void-stroke-green-500 void-size-3" /> :
    justFinished === 'error' ? <X className="void-stroke-red-500 void-size-3" /> :
    state === 'refreshing' ? <Loader2 className="void-size-3 void-animate-spin" /> :
    <RefreshCw className="void-size-3" />
    }

    disabled={state === 'refreshing' || justFinished !== null} />;

};

const RefreshableModels = () => {
  const settingsState = useSettingsState();


  const buttons = refreshableProviderNames.map((providerName) => {
    if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null;
    return <div key={providerName} className="void-pb-4">
			<RefreshModelButton providerName={providerName} />
		</div>;
  });

  return <>
		{buttons}
	</>;

};



const AddModelMenu = ({ onSubmit }: {onSubmit: () => void;}) => {

  const accessor = useAccessor();
  const settingsStateService = accessor.get('IVoidSettingsService');

  const settingsState = useSettingsState();

  // const providerNameRef = useRef<ProviderName | null>(null)
  const [providerName, setProviderName] = useState<ProviderName | null>(null);

  const modelNameRef = useRef<HTMLTextAreaElement | null>(null);

  const [errorString, setErrorString] = useState('');


  return <>
		<div className="void-flex void-items-center void-gap-4">

			{/* provider */}
			<VoidCustomDropdownBox
        options={providerNames}
        selectedOption={providerName}
        onChangeOption={(pn) => setProviderName(pn)}
        getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : '(null)'}
        getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : '(null)'}
        getOptionsEqual={(a, b) => a === b}
        className={`void-max-w-44 void-w-full void-border void-border-void-border-2 void-bg-void-bg-1 void-text-void-fg-3 void-text-root void-py-[4px] void-px-[6px] `}


        arrowTouchesText={false} />

			{/* <_VoidSelectBox
        	onCreateInstance={useCallback(() => { providerNameRef.current = providerOptions[0].value }, [providerOptions])} // initialize state
        	onChangeSelection={useCallback((providerName: ProviderName) => { providerNameRef.current = providerName }, [])}
        	options={providerOptions}
        /> */}

			{/* model */}
			<div className="void-max-w-44 void-w-full void-border void-border-void-border-2 void-bg-void-bg-1 void-text-void-fg-3 void-text-root">
				<VoidInputBox2
          placeholder='Model Name'
          className="void-mt-[2px] void-px-[6px] void-h-full void-w-full"
          ref={modelNameRef}
          multiline={false} />

			</div>

			{/* button */}
			<div className="void-max-w-40">
				<VoidButton onClick={() => {
          const modelName = modelNameRef.current?.value;

          if (providerName === null) {
            setErrorString('Please select a provider.');
            return;
          }
          if (!modelName) {
            setErrorString('Please enter a model name.');
            return;
          }
          // if model already exists here
          if (settingsState.settingsOfProvider[providerName].models.find((m) => m.modelName === modelName)) {
            setErrorString(`This model already exists under ${providerName}.`);
            return;
          }

          settingsStateService.addModel(providerName, modelName);
          onSubmit();

        }}>
          Add model</VoidButton>
			</div>

			{!errorString ? null : <div className="void-text-red-500 void-truncate void-whitespace-nowrap">
				{errorString}
			</div>}
		</div>

	</>;

};

const AddModelMenuFull = () => {
  const [open, setOpen] = useState(false);

  return <div className="hover:void-bg-black/10 dark:hover:void-bg-gray-300/10 void-py-1 void-my-4 void-pb-1 void-px-3 void-rounded-sm void-overflow-hidden ">
		{open ?
    <AddModelMenu onSubmit={() => {setOpen(false);}} /> :
    <VoidButton onClick={() => setOpen(true)}>Add Model</VoidButton>
    }
	</div>;
};


export const ModelDump = () => {

  const accessor = useAccessor();
  const settingsStateService = accessor.get('IVoidSettingsService');

  const settingsState = useSettingsState();

  // a dump of all the enabled providers' models
  const modelDump: (VoidModelInfo & {providerName: ProviderName;providerEnabled: boolean;})[] = [];
  for (let providerName of providerNames) {
    const providerSettings = settingsState.settingsOfProvider[providerName];
    // if (!providerSettings.enabled) continue
    modelDump.push(...providerSettings.models.map((model) => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })));
  }

  // sort by hidden
  modelDump.sort((a, b) => {
    return Number(b.providerEnabled) - Number(a.providerEnabled);
  });

  return <div className="">
		{modelDump.map((m, i) => {
      const { isHidden, isDefault, isAutodetected, modelName, providerName, providerEnabled } = m;

      const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName;

      const disabled = !providerEnabled;

      return <div key={`${modelName}${providerName}`}
      className={`void-flex void-items-center void-justify-between void-gap-4 hover:void-bg-black/10 dark:hover:void-bg-gray-300/10 void-py-1 void-px-3 void-rounded-sm void-overflow-hidden void-cursor-default void-truncate `}>


				{/* left part is width:full */}
				<div className={`void-flex-grow void-flex void-items-center void-gap-4`}>
					<span className="void-w-full void-max-w-32">{isNewProviderName ? displayInfoOfProviderName(providerName).title : ''}</span>
					<span className="void-w-fit void-truncate">{modelName}</span>
				</div>
				{/* right part is anything that fits */}
				<div className="void-flex void-items-center void-gap-4">
					<span className="void-opacity-50 void-truncate">{isAutodetected ? '(detected locally)' : isDefault ? '' : '(custom model)'}</span>

					<VoidSwitch
            value={disabled ? false : !isHidden}
            onChange={() => {
              settingsStateService.toggleModelHidden(providerName, modelName);
            }}
            disabled={disabled}
            size='sm' />


					<div className={`void-w-5 void-flex void-items-center void-justify-center`}>
						{isDefault ? null : <button onClick={() => {settingsStateService.deleteModel(providerName, modelName);}}><X className="void-size-4" /></button>}
					</div>
				</div>
			</div>;
    })}
	</div>;
};



// providers

const ProviderSetting = ({ providerName, settingName }: {providerName: ProviderName;settingName: SettingName;}) => {


  // const { title: providerTitle, } = displayInfoOfProviderName(providerName)

  const { title: settingTitle, placeholder, subTextMd } = displayInfoOfSettingName(providerName, settingName);

  const accessor = useAccessor();
  const voidSettingsService = accessor.get('IVoidSettingsService');

  let weChangedTextRef = false;

  return <ErrorBoundary>
		<div className="void-my-1">
			<VoidInputBox
      // placeholder={`${providerTitle} ${settingTitle} (${placeholder})`}
      placeholder={`${settingTitle} (${placeholder})`}
      onChangeText={useCallback((newVal) => {
        if (weChangedTextRef) return;
        voidSettingsService.setSettingOfProvider(providerName, settingName, newVal);
      }, [voidSettingsService, providerName, settingName])}

      // we are responsible for setting the initial value. always sync the instance whenever there's a change to state.
      onCreateInstance={useCallback((instance: InputBox) => {
        const syncInstance = () => {
          const settingsAtProvider = voidSettingsService.state.settingsOfProvider[providerName];
          const stateVal = settingsAtProvider[settingName as SettingName];

          // console.log('SYNCING TO', providerName, settingName, stateVal)
          weChangedTextRef = true;
          instance.value = stateVal as string;
          weChangedTextRef = false;
        };

        syncInstance();
        const disposable = voidSettingsService.onDidChangeState(syncInstance);
        return [disposable];
      }, [voidSettingsService, providerName, settingName])}
      multiline={false} />

			{subTextMd === undefined ? null : <div className="void-py-1 void-px-3 void-opacity-50 void-text-sm">
				<ChatMarkdownRender noSpace string={subTextMd} />
			</div>}

		</div>
	</ErrorBoundary>;
};

const SettingsForProvider = ({ providerName }: {providerName: ProviderName;}) => {
  const voidSettingsState = useSettingsState();

  const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel';

  // const accessor = useAccessor()
  // const voidSettingsService = accessor.get('IVoidSettingsService')

  // const { enabled } = voidSettingsState.settingsOfProvider[providerName]
  const settingNames = customSettingNamesOfProvider(providerName);

  const { title: providerTitle } = displayInfoOfProviderName(providerName);

  return <div className="void-my-4">

		<div className="void-flex void-items-center void-w-full void-gap-4">
			<h3 className="void-text-xl void-truncate">{providerTitle}</h3>

			{/* enable provider switch */}
			{/* <VoidSwitch
        value={!!enabled}
        onChange={
        	useCallback(() => {
        		const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
        		voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
        	}, [voidSettingsService, providerName])}
        size='sm+'
        /> */}
		</div>

		<div className="void-px-0">
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {
        return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />;
      })}

			{needsModel ?
      providerName === 'ollama' ?
      <WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} /> :
      <WarningBox text={`Please add a model for ${providerTitle} below (Models).`} /> :
      null}
		</div>
	</div>;
};


export const VoidProviderSettings = ({ providerNames }: {providerNames: ProviderName[];}) => {
  return <>
		{providerNames.map((providerName) =>
    <SettingsForProvider key={providerName} providerName={providerName} />
    )}
	</>;
};


type TabName = 'models' | 'general';
export const AutoRefreshToggle = () => {
  const settingName: GlobalSettingName = 'autoRefreshModels';

  const accessor = useAccessor();
  const voidSettingsService = accessor.get('IVoidSettingsService');
  const metricsService = accessor.get('IMetricsService');

  const voidSettingsState = useSettingsState();

  // right now this is just `enabled_autoRefreshModels`
  const enabled = voidSettingsState.globalSettings[settingName];

  return <SubtleButton
    onClick={() => {
      voidSettingsService.setGlobalSetting(settingName, !enabled);
      metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: !enabled });
    }}
    text={`Automatically detect local providers and models (${refreshableProviderNames.map((providerName) => displayInfoOfProviderName(providerName).title).join(', ')}).`}
    icon={enabled ? <Check className="void-stroke-green-500 void-size-3" /> : <X className="void-stroke-red-500 void-size-3" />}
    disabled={false} />;

};

export const AIInstructionsBox = () => {
  const accessor = useAccessor();
  const voidSettingsService = accessor.get('IVoidSettingsService');
  const voidSettingsState = useSettingsState();
  return <VoidInputBox2
    className="void-min-h-[81px] void-p-3 void-rounded-sm"
    initValue={voidSettingsState.globalSettings.aiInstructions}
    placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Respond to all queries in French. `}
    multiline
    onChangeText={(newText) => {
      voidSettingsService.setGlobalSetting('aiInstructions', newText);
    }} />;

};

export const FeaturesTab = () => {
  return <>
		<h2 className={`void-text-3xl void-mb-2`}>Local Providers</h2>
		{/* <h3 className={`opacity-50 mb-2`}>{`Keep your data private by hosting AI locally on your computer.`}</h3> */}
		{/* <h3 className={`opacity-50 mb-2`}>{`Instructions:`}</h3> */}
		{/* <h3 className={`mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3> */}
		<h3 className={`void-text-void-fg-3 void-mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3>
		<div className="void-pl-4 void-opacity-50">
			<span className={`void-text-sm void-mb-2`}><ChatMarkdownRender noSpace string={`1. Download [Ollama](https://ollama.com/download).`} /></span>
			<span className={`void-text-sm void-mb-2`}><ChatMarkdownRender noSpace string={`2. Open your terminal.`} /></span>
			<span className={`void-text-sm void-mb-2 void-select-text`}><ChatMarkdownRender noSpace string={`3. Run \`ollama run llama3.1\`. This installs Meta's llama3.1 model which is best for chat and inline edits. Requires 5GB of memory.`} /></span>
			<span className={`void-text-sm void-mb-2 void-select-text`}><ChatMarkdownRender noSpace string={`4. Run \`ollama run qwen2.5-coder:1.5b\`. This installs a faster autocomplete model. Requires 1GB of memory.`} /></span>
			<span className={`void-text-sm void-mb-2`}><ChatMarkdownRender noSpace string={`Void automatically detects locally running models and enables them.`} /></span>
			{/* TODO we should create UI for downloading models without user going into terminal */}
		</div>

		<ErrorBoundary>
			<VoidProviderSettings providerNames={localProviderNames} />
		</ErrorBoundary>

		<h2 className={`void-text-3xl void-mb-2 void-mt-12`}>Providers</h2>
		<h3 className={`void-text-void-fg-3 void-mb-2`}>{`Void can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>
		{/* <h3 className={`opacity-50 mb-2`}>{`Access models like ChatGPT and Claude. We recommend using Anthropic or OpenAI as providers, or Groq as a faster alternative.`}</h3> */}
		<ErrorBoundary>
			<VoidProviderSettings providerNames={nonlocalProviderNames} />
		</ErrorBoundary>

		<h2 className={`void-text-3xl void-mb-2 void-mt-12`}>Models</h2>
		<ErrorBoundary>
			<AutoRefreshToggle />
			<RefreshableModels />
			<ModelDump />
			<AddModelMenuFull />
		</ErrorBoundary>
	</>;
};



// https://github.com/VSCodium/vscodium/blob/master/docs/index.md#migrating-from-visual-studio-code-to-vscodium
// https://code.visualstudio.com/docs/editor/extension-marketplace#_where-are-extensions-installed
type TransferFilesInfo = {from: URI;to: URI;}[];
const transferTheseFilesOfOS = (os: 'mac' | 'windows' | 'linux' | null): TransferFilesInfo => {
  if (os === null)
  throw new Error(`One-click switch is not possible in this environment.`);
  if (os === 'mac') {
    const homeDir = env['HOME'];
    if (!homeDir) throw new Error(`$HOME not found`);
    return [{
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'keybindings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions')
    }];
  }

  if (os === 'linux') {
    const homeDir = env['HOME'];
    if (!homeDir) throw new Error(`variable for $HOME location not found`);
    return [{
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'settings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'keybindings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions')
    }];
  }

  if (os === 'windows') {
    const appdata = env['APPDATA'];
    if (!appdata) throw new Error(`variable for %APPDATA% location not found`);
    const userprofile = env['USERPROFILE'];
    if (!userprofile) throw new Error(`variable for %USERPROFILE% location not found`);

    return [{
      from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'settings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'keybindings.json'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json')
    }, {
      from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.vscode', 'extensions'),
      to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions')
    }];
  }

  throw new Error(`os '${os}' not recognized`);
};

const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null;
let transferTheseFiles: TransferFilesInfo = [];
let transferError: string | null = null;

try {transferTheseFiles = transferTheseFilesOfOS(os);}
catch (e) {transferError = e + '';}

const OneClickSwitchButton = () => {
  const accessor = useAccessor();
  const fileService = accessor.get('IFileService');

  const [state, setState] = useState<{type: 'done';error?: string;} | {type: 'loading' | 'justfinished';}>({ type: 'done' });

  if (transferTheseFiles.length === 0)
  return <>
			<WarningBox text={transferError ?? `One-click switch not available.`} />
		</>;



  const onClick = async () => {

    if (state.type !== 'done') return;

    setState({ type: 'loading' });

    let errAcc = '';
    for (let { from, to } of transferTheseFiles) {
      console.log('transferring', from, to);
      // not sure if this can fail, just wrapping it with try/catch for now
      try {await fileService.copy(from, to, true);}
      catch (e) {errAcc += e + '\n';}
    }
    const hadError = !!errAcc;
    if (hadError) {
      setState({ type: 'done', error: errAcc });
    } else
    {
      setState({ type: 'justfinished' });
      setTimeout(() => {setState({ type: 'done' });}, 3000);
    }
  };

  return <>
		<VoidButton disabled={state.type !== 'done'} onClick={onClick}>
			{state.type === 'done' ? 'Transfer my Settings' :
      state.type === 'loading' ? 'Transferring...' :
      state.type === 'justfinished' ? 'Success!' :
      null
      }
		</VoidButton>
		{state.type === 'done' && state.error ? <WarningBox text={state.error} /> : null}
	</>;
};


const GeneralTab = () => {
  const accessor = useAccessor();
  const commandService = accessor.get('ICommandService');

  return <>


		<div className="">
			<h2 className={`void-text-3xl void-mb-2`}>One-Click Switch</h2>
			<h4 className={`void-text-void-fg-3 void-mb-2`}>{`Transfer your settings from VS Code to Void in one click.`}</h4>
			<OneClickSwitchButton />
		</div>



		<div className="void-mt-12">
			<h2 className={`void-text-3xl void-mb-2`}>Built-in Settings</h2>
			<h4 className={`void-text-void-fg-3 void-mb-2`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

			<div className="void-my-4">
				<VoidButton onClick={() => {commandService.executeCommand('workbench.action.openSettings');}}>
					General Settings
				</VoidButton>
			</div>
			<div className="void-my-4">
				<VoidButton onClick={() => {commandService.executeCommand('workbench.action.openGlobalKeybindings');}}>
					Keyboard Settings
				</VoidButton>
			</div>
			<div className="void-my-4">
				<VoidButton onClick={() => {commandService.executeCommand('workbench.action.selectTheme');}}>
					Theme Settings
				</VoidButton>
			</div>
		</div>


		<div className="void-mt-12">
			<h2 className={`void-text-3xl void-mb-2`}>AI Instructions</h2>
			<h4 className={`void-text-void-fg-3 void-mb-2`}>{`Instructions to include on all AI requests.`}</h4>
			<AIInstructionsBox />
		</div>

		<div className="void-mt-12">
			<h2 className={`void-text-3xl void-mb-2`}>Model Selection</h2>
			{featureNames.map((featureName) =>
      <div key={featureName}
      className="void-mb-2">

					<h4 className={`void-text-void-fg-3`}>{displayInfoOfFeatureName(featureName)}</h4>
					<ModelDropdown featureName={featureName} />
				</div>
      )}
		</div>

	</>;
};

// full settings

export const Settings = () => {
  const isDark = useIsDark();

  const [tab, setTab] = useState<TabName>('models');

  const containerRef = useRef<HTMLDivElement | null>(null);
  useScrollbarStyles(containerRef);

  return <div className={`void-scope ${isDark ? "void-dark" : ""}`} style={{ height: '100%', width: '100%' }}>
		<div ref={containerRef} className="void-overflow-y-auto void-w-full void-h-full void-px-10 void-py-10 void-select-none">

			<div className="void-max-w-5xl void-mx-auto">

				<h1 className="void-text-2xl void-w-full">Void Settings</h1>

				{/* separator */}
				<div className="void-w-full void-h-[1px] void-my-4" />

				<div className="void-flex void-items-stretch">

					{/* tabs */}
					<div className="void-flex void-flex-col void-w-full void-max-w-32">
						<button className={`void-text-left void-p-1 void-px-3 void-my-0.5 void-rounded-sm void-overflow-hidden ${tab === 'models' ? "void-bg-black/10 dark:void-bg-gray-200/10" : ""} hover:void-bg-black/10 hover:dark:void-bg-gray-200/10 active:void-bg-black/10 active:dark:void-bg-gray-200/10 `}
            onClick={() => {setTab('models');}}>
              Models</button>
						<button className={`void-text-left void-p-1 void-px-3 void-my-0.5 void-rounded-sm void-overflow-hidden ${tab === 'general' ? "void-bg-black/10 dark:void-bg-gray-200/10" : ""} hover:void-bg-black/10 hover:dark:void-bg-gray-200/10 active:void-bg-black/10 active:dark:void-bg-gray-200/10 `}
            onClick={() => {setTab('general');}}>
              General</button>
					</div>

					{/* separator */}
					<div className="void-w-[1px] void-mx-4" />


					{/* content */}
					<div className="void-w-full void-min-w-[600px] void-overflow-auto">

						<div className={`${tab !== 'models' ? "void-hidden" : ""}`}>
							<FeaturesTab />
						</div>

						<div className={`${tab !== 'general' ? "void-hidden" : ""}`}>
							<GeneralTab />
						</div>

					</div>
				</div>

			</div>
		</div>

	</div>;
};