
Run `node build.js` to compile the React into `out/`.

A couple things to remember:

- Make sure to add .js at the end of any external imports used in here.

- src/ needs to be shallow so the detection of externals works properly (see tsup.config.js).


