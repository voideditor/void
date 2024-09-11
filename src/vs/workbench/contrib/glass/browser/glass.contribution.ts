import { Registry } from 'vs/platform/registry/common/platform';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptor
} from 'vs/workbench/common/views';

import * as nls from 'vs/nls';

import { GlassViewPane } from 'vs/workbench/contrib/glass/browser/glassViewPane'

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';

import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';


const glassViewIcon = registerIcon('glass-view-icon', Codicon.search, localize('glassViewIcon', 'View icon of the glass chat view.'));


// compare against search.contribution.ts and https://app.greptile.com/chat/w1nsmt3lauwzculipycpn?repo=github%3Amain%3Amicrosoft%2Fvscode
// and debug.contribution.ts, scm.contribution.ts (source control)

const VIEW_CONTAINER_ID = 'workbench.view.glass' // called VIEWLET_ID in other places for some reason

// Register view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewContainer = viewContainerRegistry.registerViewContainer({
	id: VIEW_CONTAINER_ID,
	title: nls.localize2('glass', 'Glass'), // this is used to say GLASS (Ctrl + L)
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: false,
	icon: glassViewIcon,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });





// this is called a descriptor, but it's the actual View that gets used inside the view container
const VIEW_ID = VIEW_CONTAINER_ID // not sure if we can change this
const viewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	containerIcon: glassViewIcon,
	name: nls.localize2('glass chat', "Chat"), // this says : CHAT
	// ctorDescriptor: new SyncDescriptor(GlassViewPane),
	ctorDescriptor: new SyncDescriptor(GlassViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: viewContainer.id,
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyCode.KeyL, // we don't need to disable the original ctrl+L (probably because it brings panel into focus first)
		},
		order: 1
		// mnemonicTitle: nls.localize({ key: 'miViewSearch', comment: ['&& denotes a mnemonic'] }, "&&Search"),
	}
};




// Register search default location to the container (sidebar)
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);


// TODO can add a configuration for the user to choose config options - see search.contribution.ts


