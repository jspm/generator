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
`), '\n' +
'<!doctype html>\n' +
'<script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js" crossorigin="anonymous"></script>\n' +     
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
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n'), '\n' +
'<!doctype html>\n' +
'<script async src="https://ga.jspm.io/npm:es-module-shims@1.4.1/dist/es-module-shims.js" crossorigin="anonymous"></script>\n' +     
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
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n');
