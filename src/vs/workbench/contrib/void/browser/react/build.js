import { execSync } from 'child_process';

// tsup to build all react to out/
execSync('tsup')

// build tailwind -> styles.css
execSync('tailwindcss -i ./util/styles.css -o ./out/styles.css')

// the structure of files here MUST be shallow so that external = ../../ works

