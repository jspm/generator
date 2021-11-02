import { analyzeHtml } from '#html/analyze';
import { init } from 'es-module-lexer';
import { deepStrictEqual, strictEqual } from 'assert';

await init;

const analysis = analyzeHtml(`

<script type="importmap">
  {
    "imports": {
      "react": "/react.js"
    }
  }
</script>

<script async src="https://ga.jspm.io/npm:es-module-shims@0.12.8/dist/es-module-shims.min.js" integrity="sha384-Gba99Cy/cyqL1MpdnMzkUKYpebrPnBrQ5xnOoqJJNQstoxJQjAE4xgr80AiDYuTA" crossorigin="anonymous"></script>

<link rel=modulepreload href="./subdep.js" integrity="asdf" />

<script type="module">
import 'react';
</script>

<script type="module" src="./local.js"></script>
<script type="module" src="/absolute.js"></script>

<script>
import('/dynamic');
</script>

`);

deepStrictEqual(analysis.map, {
  start: 2,
  end: 95,
  attrs: [{
    name: 'type',
    quote: '"',
    value: 'importmap'
  }],
  json: {
    imports: {
      react: '/react.js'
    }
  },
  postInject: '\n\n',
  style: {
    indent: '  ',
    newline: '\n',
    quote: '"',
    tab: '  ',
    trailingNewline: '\n'
  }
});

deepStrictEqual(analysis.preloads, [{
  start: 308,
  end: 422,
  attrs: [
    { quote: '', name: 'rel', value: 'modulepreload' },
    { quote: '"', name: 'href', value: './subdep.js' },
    { quote: '"', name: 'integrity', value: 'asdf' }
  ]
}]);

deepStrictEqual([...analysis.staticImports], ['./local.js', '/absolute.js']);

deepStrictEqual([...analysis.dynamicImports], ['/dynamic']);

strictEqual(analysis.hasESMS, true);
