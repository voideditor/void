# decode-uri-component (vendored CommonJS build of 0.5.0)

This directory vendors [decode-uri-component](https://github.com/SamVerschueren/decode-uri-component)
(MIT, (c) Sam Verschueren) version **0.5.0** as a **CommonJS** package.

## Why

- Upstream `0.5.0` is the only release that fixes
  [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
  (Denial of service via exponential decoding of malformed percent-encoded input,
  affects `decode-uri-component <= 0.4.2`).
- Upstream `0.5.0` is published as ESM-only (`"type": "module"`).
- The only consumer chain in this repository is
  `gulp-sourcemaps@3.0.0 -> css@3.0.0 -> source-map-resolve@0.6.0`, which is CommonJS and calls
  `require("decode-uri-component")` **directly as a function**. With Node's `require(esm)` the required
  value is the module namespace object (`{__esModule, default}`), not the default export function, so
  the upstream tarball breaks `source-map-resolve` at runtime (verified on Node 22.23.2).
- A plain `"overrides": {"decode-uri-component": "0.5.0"}` therefore closes `npm audit` but breaks the
  build; the only npm-suggested alternative is downgrading `gulp-sourcemaps` to 2.6.5 (breaking).

## How it is wired in

Root `package.json`:

```json
"devDependencies": {
  "decode-uri-component": "file:./vendor/decode-uri-component"
},
"overrides": {
  "decode-uri-component": "$decode-uri-component"
}
```

`npm install`/`npm ci` resolve `node_modules/decode-uri-component` to this directory (symlink), and the
`$decode-uri-component` override forces the nested `source-map-resolve` dependency onto the same spec,
so `npm audit` no longer sees a `<=0.4.2` version of `decode-uri-component` in the tree.

## Maintenance

`index.js` is upstream `index.js` from the 0.5.0 tarball with a single change:
`export default function` -> `module.exports = function`.

If upstream publishes a CJS-compatible or dual build (or the consumer chain moves off
`source-map-resolve`), this vendor directory should be removed in favour of the registry package.
