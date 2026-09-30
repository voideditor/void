# Working on Void

The original Void project is archived: its development has stopped and patches are no longer accepted upstream. This guide is for developing your own version of Void from this source.

### Codebase Guide

We [highly recommend reading this](./VOID_CODEBASE_GUIDE.md) guide on Void's sourcecode if you'd like to add new features.

The repo is not as intimidating as it first seems if you read the guide!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/`.

## Building and Running

All build instructions live in [BUILD](./BUILD.md), split into two modes:

- **Live-edit mode** - run Void from source with a watch build and reload to see your changes. Start here if you're editing the code.
- **Building a local executable** - produce a standalone desktop build or a server-side REH package.

If you get any errors, see the [Common Fixes](./BUILD.md#common-fixes) section of the build guide.
