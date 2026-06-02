## Void is now deprecated.
Void is deprecated and no longer accepting contributions.
Thank you to everyone who contributed, both with lines of code and support from the community.

 Void remains open source and is still one of the best references to use when forking VS Code.


## Download

To view a list of newer Void forks, see the [Void Forks](http://github.com/voideditor/void-forks/) list.

To download an old version of Void, see our [Releases](https://github.com/voideditor/void/releases) page.

## Forking VS Code

If you're forking VS Code, you might still want to reference Void's logic and see our docs [here](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md) and [here](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md).

- We mount React + Tailwind. This is typically not possible in VS Code, and it required extending the build pipeline to compile React and [scope](https://github.com/andrewpareles/scope-tailwind) tailwind ourselves.

- You can copy our GitHub actions to package, sign, and auto-update Void. VS Code's build pipeline is private, so this is typically tribal knowledge.

- Our AI provider pipeline is built from scratch, so you can support custom functionality including autocomplete/FIM. We also expose grammars for common open source `<thinking>` tags, tool tags, etc.

- VoidModelService lets you edit files in the background, without worrying about differences between the raw file and in-memory buffer, or having failed writes and reads if the ITextModel was not mounted.

- Feel free to reference our architecture for using IPC, satisfying CSP, and setting up custom Services.

- Everything we've done is 100% open source. See our [repo list](https://github.com/orgs/voideditor/repositories) for a complete picture of all the repos that make up Void.



# Welcome to Void.

<div align="center">
	<img
		src="./src/vs/workbench/browser/parts/editor/media/slice_of_void.png"
	 	alt="Void Welcome"
		width="300"
	 	height="300"
	/>
</div>

Use AI agents on your codebase, checkpoint and visualize changes, and bring any model or host locally. Void sends messages directly to providers without retaining your data.

This repo contains the full sourcecode for Void's Desktop app. If you're new, welcome!

- 🧭 [Website](https://voideditor.com)

- 🚙 [Roadmap](https://github.com/orgs/voideditor/projects/2)

- 🔨 [Contribute](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md)




## Reference

Void is a fork of the [vscode](https://github.com/microsoft/vscode) repository. For a guide to our codebase, see [VOID_CODEBASE_GUIDE](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md).

For a guide on how to develop your own version of Void, see [HOW_TO_CONTRIBUTE](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md) and [void-builder](https://github.com/voideditor/void-builder).



## Support
You can always reach us in our [Discord server](https://discord.gg/RSNjgaugJs) or contact us via email at hello@voideditor.com.
