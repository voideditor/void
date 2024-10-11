Please see the `CONTRIBUTING.md` for information on how to contribute :)!


Here's an overview on how the extension works:

- The extension mounts in `extension.ts`.

- The Sidebar's HTML (everything in `sidebar/`) is built in React, and it's rendered by mounting a `<script>` tag - see `SidebarWebviewProvider.ts`.
