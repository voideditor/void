import { execSync } from 'child_process';

// clear out dirs
execSync('npx rimraf out/ && npx rimraf src2/')

// tsup to build all react to out/
execSync('npx scope-tailwind ./src -o src2/ -s void-scope -c styles.css')

// build tailwind -> styles.css
execSync('tsup')

// the structure of files here MUST be shallow so that external = ../../ works

