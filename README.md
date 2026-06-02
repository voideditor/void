## Void is now deprecated.
Void is deprecated and no longer accepting contributions.
Thank you to everyone who contributed, both with lines of code and support from the community.

 Void remains open source and is still one of the best references to use when forking VS Code.



## Forking VS Code

You might want to reference Void's logic if you're forking VS Code.

- We mount React + Tailwind. This is typically not possible in VS Code, and it required extending the build pipeline to compile React and [scope](https://github.com/andrewpareles/scope-tailwind) tailwind ourselves.

- We expose GitHub actions that package, sign, and auto-update Void. Surprisingly, VS Code's build pipeline is private, so it's hard to figure this out yourself.

- We have a Service that lets you modify files in the background, without worrying about in-memory vs raw-file differences or having failed writes and reads if the ITextModel was not mounted.

- Our AI provider pipeline is built from scratch, allowing you to support custom functionality like autocomplete/FIM models.

- We provide examples of creating custom Services, doing IPC, securely networking with HTTP to AI providers while satisfying CSP, and using core VS Code Services and Actions.

- Everything we've done is 100% open source. See [here](https://github.com/orgs/voideditor/repositories) for a complete picture of all the repos that make up Void.

## Old Download

To download an old version of Void, see our [Releases](https://github.com/voideditor/void/releases) page.



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

- 👨‍💻 [Codebase Guide](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md)

- 🚙 [Project Board](https://github.com/orgs/voideditor/projects/2)

- 🔨 [Contribute](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md)


## Reference

Void is a fork of the [vscode](https://github.com/microsoft/vscode) repository. For a guide to our codebase, see [VOID_CODEBASE_GUIDE](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md).

For a guide on how to develop your own version of Void, see [HOW_TO_CONTRIBUTE](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md) and [void-builder](https://github.com/voideditor/void-builder).



## Support
You can always reach us in our [Discord server](https://discord.gg/RSNjgaugJs) or contact us via email at hello@voideditor.com.
