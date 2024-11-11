import { execSync } from 'child_process';

// tsup to build all react to out/
execSync('npx scope-tailwind ./sidebar-tsx -c ')

// build tailwind -> styles.css
execSync('tsup')

// the structure of files here MUST be shallow so that external = ../../ works

