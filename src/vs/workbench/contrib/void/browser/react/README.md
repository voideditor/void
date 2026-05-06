
Run `node build.js` to compile the React into `out/`.

A couple things to remember:

- Make sure to add .js at the end of any external imports used in here, e.g. ../../../../../my_file.js. If you don't do this, you will get untraceable errors.

- src/ needs to be shallow (1 folder deep) so the detection of externals works properly (see tsup.config.js).


