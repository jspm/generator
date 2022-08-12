import { Generator } from '@jspm/generator';
import assert from 'assert';
import { SemverRange } from 'sver';

const generator = new Generator({
  rootUrl: new URL('./local', import.meta.url),
  env: ['production', 'browser'],
  resolutions: {
    react: '17'
  }
});

const { pkg: esmsPkg } = await generator.traceMap.resolver.resolveLatestTarget({ name: 'es-module-shims', registry: 'npm', ranges: [new SemverRange('*')] }, generator.traceMap.installer.defaultProvider);
const esmsUrl = generator.traceMap.resolver.pkgToUrl(esmsPkg, generator.traceMap.installer.defaultProvider) + 'dist/es-module-shims.js';

assert.strictEqual(await generator.htmlGenerate(`<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>SOMISANA</title>
  <meta name="description" content="Sustainable Ocean Modelling Initiative: A South African Approach" />

  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
  <link rel="manifest" href="/site.webmanifest">

  <script>
    window.process = {
      env: {},
    }
  </script>

  <!-- Global site tag (gtag.js) - Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    gtag('js', new Date());

    gtag('config', 'G-XXX');
  </script>

  <script type="module">
    import 'react';
  </script>
</head>

<body>
  <div id="root"></div>
</body>

</html>`, { preload: true }), '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'\n' +
'  <title>SOMISANA</title>\n' +
'  <meta name="description" content="Sustainable Ocean Modelling Initiative: A South African Approach" />\n' +
'\n' +
'  <!-- Generated by @jspm/generator - https://github.com/jspm/generator -->\n' +
`<script async src="${esmsUrl}" crossorigin="anonymous"></script>\n` +
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
'<link rel="modulepreload" href="https://ga.jspm.io/npm:object-assign@4.1.1/index.js" />\n' +
'<link rel="modulepreload" href="https://ga.jspm.io/npm:react@17.0.2/index.js" />\n' +
'<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">\n' +
'  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n' +
'  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">\n' +
'  <link rel="manifest" href="/site.webmanifest">\n' +
'\n' +
'  <script>\n' +
'    window.process = {\n' +
'      env: {},\n' +
'    }\n' +
'  </script>\n' +
'\n' +
'  <!-- Global site tag (gtag.js) - Google Analytics -->\n' +
'  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script>\n' +
'  <script>\n' +
'    window.dataLayer = window.dataLayer || [];\n' +
'    function gtag() { dataLayer.push(arguments); }\n' +
"    gtag('js', new Date());\n" +
'\n' +
"    gtag('config', 'G-XXX');\n" +
'  </script>\n' +
'\n' +
'  <script type="module">\n' +
"    import 'react';\n" +
'  </script>\n' +
'</head>\n' +
'\n' +
'<body>\n' +
'  <div id="root"></div>\n' +
'</body>\n' +
'\n' +
'</html>');
