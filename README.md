## Void is now deprecated.
Void is deprecated and no longer accepting contributions.
Thank you to everyone who contributed, both with lines of code and support from the community. Void remains open source and is still one of the best references to use when forking VS Code.


## Download

To view a list of newer Void forks, see [Void Forks](http://github.com/voideditor/void-forks/).

To download an old version of Void, see [Releases](https://github.com/voideditor/void/releases).

## Forking VS Code

If you're forking VS Code, you might still want to reference Void's logic, and see our [Codebase Guide](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md) and [How to Contribute](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md).

- We mount React + Tailwind. This is typically not possible in VS Code, and it required extending the build pipeline to compile React and [scope](https://github.com/andrewpareles/scope-tailwind) Tailwind ourselves.

- You can copy our GitHub Actions to package, sign, and auto-update Void. VS Code's build pipeline is private, so this is typically tribal knowledge.

- Our AI completions pipeline is built from scratch, allowing us to support autocomplete (FIM) and other custom responses. We also expose grammars for common `<thinking>` tags, tool tags, etc.

- Use VoidModelService to edit files in the background, without having subtle `ITextModel` write errors. It syncs OS-level files with your text buffers.

- Feel free to reference our architecture for using IPC and satisfying CSP.

- Everything we've done is 100% open source. See [repos](https://github.com/orgs/voideditor/repositories) for a complete picture of all the repos that make up Void.



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
