import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('./local/page.html', import.meta.url),
  env: ['production', 'browser']
});

assert.strictEqual(await generator.htmlGenerate(`
<!doctype html>
<script type="module">
  import 'react';
</script>
`, { preload: true, integrity: true }), '\n' +
'<!doctype html>\n' +
'<script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js" crossorigin="anonymous" integrity="sha384-KqbnIVokesGNC0MknInEbFCUdjO3a1mNBxgfPZ+6SqOcQtK7/7dTQOZX0l6mpeUA"></script>\n' +     
'<script type="importmap">\n' +
'{\n' +
'  "imports": {\n' +
'    "react": "https://ga.jspm.io/npm:react@17.0.2/index.js"\n' +
'  },\n' +
'  "scopes": {\n' +
'    "https://ga.jspm.io/": {\n' +
'      "object-assign": "https://ga.jspm.io/npm:object-assign@4.1.1/index.js"\n' +
'    }\n' +
'  }\n' +
'}\n' +
'</script>\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" integrity="sha384-XapV4O3iObT3IDFIFYCLWwO8NSi+SIOMlAWsO3n8+HsPNzAitpl3cdFHbe+msAQY" />\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:object-assign@4.1.1/index.js" integrity="sha384-iQp1zoaqIhfUYyYkz3UNk1QeFfmBGgt1Ojq0kZD5Prql1g7fgJVzVgsjDoR65lv8" />\n' +
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n');

// Idempotency
assert.strictEqual(await generator.htmlGenerate('\n' +
'<!doctype html>\n' +
'<script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js"></script>\n' +     
'<script type="importmap">\n' +
'{\n' +
'  "imports": {\n' +
'    "react": "https://ga.jspm.io/npm:react@17.0.2/index.js"\n' +
'  },\n' +
'  "scopes": {\n' +
'    "https://ga.jspm.io/": {\n' +
'      "object-assign": "https://ga.jspm.io/npm:object-assign@4.1.1/index.js"\n' +
'    }\n' +
'  }\n' +
'}\n' +
'</script>\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" integrity="sha384-XapV4O3iObT3IDFIFYCLWwO8NSi+SIOMlAWsO3n8+HsPNzAitpl3cdFHbe+msAQY" />\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:object-assign@4.1.1/index.js" integrity="sha384-iQp1zoaqIhfUYyYkz3UNk1QeFfmBGgt1Ojq0kZD5Prql1g7fgJVzVgsjDoR65lv8" />\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/cjs/react.production.min.js" integrity="sha384-vXMyhkZyH+f511olSQcszeIja6v6wqVgCllFQ5yk4qCDfVRzDEHt90aYx9e6V1KL" />\n' +
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n', { preload: true, integrity: true, whitespace: false }), '\n' +
'<!doctype html>\n' +
'<script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js" crossorigin="anonymous" integrity="sha384-KqbnIVokesGNC0MknInEbFCUdjO3a1mNBxgfPZ+6SqOcQtK7/7dTQOZX0l6mpeUA"></script>\n' +     
'<script type="importmap">{"imports":{"react":"https://ga.jspm.io/npm:react@17.0.2/index.js"},"scopes":{"https://ga.jspm.io/":{"object-assign":"https://ga.jspm.io/npm:object-assign@4.1.1/index.js"}}}</script>\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" integrity="sha384-XapV4O3iObT3IDFIFYCLWwO8NSi+SIOMlAWsO3n8+HsPNzAitpl3cdFHbe+msAQY" /><link rel="modulepreload" href="https://ga.jspm.io/npm:object-assign@4.1.1/index.js" integrity="sha384-iQp1zoaqIhfUYyYkz3UNk1QeFfmBGgt1Ojq0kZD5Prql1g7fgJVzVgsjDoR65lv8" />\n' +
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n');
