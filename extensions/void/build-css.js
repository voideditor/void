const tailwindcss = require('tailwindcss')
const autoprefixer = require('autoprefixer')
const postcss = require('postcss')
const fs = require('fs')

const from = 'src/sidebar/styles.css'
const to = 'dist/sidebar/styles.css'

const original_css_contents = fs.readFileSync(from, 'utf8')

postcss([
    tailwindcss, // this compiles tailwind of all the files specified in tailwind.config.json
    autoprefixer,
])
    .process(original_css_contents, { from, to })
    .then(processed_css_contents => { fs.writeFileSync(to, processed_css_contents.css) })
    .catch(error => {
        console.error('Error in build-css:', error)
    })