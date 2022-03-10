import { Generator } from '@jspm/generator';
import assert from 'assert';
import { SemverRange } from 'sver';

const generator = new Generator({
  rootUrl: new URL('./local', import.meta.url),
  env: ['production', 'browser']
});

const esmsPkg = await generator.traceMap.resolver.resolveLatestTarget({ name: 'es-module-shims', registry: 'npm', ranges: [new SemverRange('*')] }, false, generator.traceMap.installer.defaultProvider);
const esmsUrl = generator.traceMap.resolver.pkgToUrl(esmsPkg, generator.traceMap.installer.defaultProvider) + 'dist/es-module-shims.js';

assert.strictEqual(await generator.htmlGenerate(`
<!doctype html>
<script type="importmap">
{
  "imports": {
    "object-assign": "/react.js"
  }
}
</script>
<script type="module">
  import 'react';
</script>
`, { preload: true }), '\n' +
'<!doctype html>\n' +
`<script async src="${esmsUrl}" crossorigin="anonymous"></script>\n` +
'<script type="importmap">\n' +
'{\n' +
'  "imports": {\n' +
'    "object-assign": "/react.js",\n' +
'    "react": "https://ga.jspm.io/npm:react@17.0.2/index.js"\n' +
'  }\n' +
'}\n' +
'</script>\n' +
'<link rel="modulepreload" href="/react.js" />\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" />\n' +
'<script type="module">\n' +
"  import 'react';\n" +
'</script>\n');

{
  const generator = new Generator({
    rootUrl: new URL('./local', import.meta.url),
    env: ['production', 'browser']
  });

  // TODO: Fix scope base idempotency
  // Idempotency
  assert.strictEqual(await generator.htmlGenerate('\n' +
  '<!doctype html>\n' +
  `<script async src="${esmsUrl}" crossorigin="anonymous"></script>\n` +
  '<script type="importmap">\n' +
  '{\n' +
  '  "imports": {\n' +
  '    "react": "https://ga.jspm.io/npm:react@17.0.2/index.js"\n' +
  '  },\n' +
  '  "scopes": {\n' +
  '    "https://ga.jspm.io/npm:react@17.0.2/": {\n' +
  '      "object-assign": "https://ga.jspm.io/npm:object-assign@4.1.0/index.js"\n' +
  '    }\n' +
  '  }\n' +
  '}\n' +
  '</script>\n' +
  '<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.1/index.js" />\n' +
  '<link rel="modulepreload" href="/react.js" />\n' +
  '<script type="module">\n' +
  "  import 'react';\n" +
  '</script>\n', { preload: true, whitespace: false }), '\n' +
  '<!doctype html>\n' +
  `<script async src="${esmsUrl}" crossorigin="anonymous"></script>\n` +
  '<script type="importmap">{"imports":{"react":"https://ga.jspm.io/npm:react@17.0.2/index.js"},"scopes":{"https://ga.jspm.io/":{"object-assign":"https://ga.jspm.io/npm:object-assign@4.1.0/index.js"}}}</script>\n' +
  '<link rel="modulepreload" href="https://ga.jspm.io/npm:object-assign@4.1.0/index.js" /><link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" />\n' +
  '<script type="module">\n' +
  "  import 'react';\n" +
  '</script>\n');
}
