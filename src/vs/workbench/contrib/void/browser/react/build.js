import { execSync } from 'child_process';

// clear temp dirs
execSync('npx rimraf out/ && npx rimraf src2/')

// build and scope tailwind
execSync('npx scope-tailwind ./src -o src2/ -s void-scope -c styles.css')

// tsup to build src2/ into out/
execSync('tsup')


