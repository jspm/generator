import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('./local/page.html', import.meta.url),
  env: ['production', 'browser']
});

await generator.traceHtml(`
<!doctype html>
<script type="module">
import 'react';
</script>
`);

const json = generator.getMap();

assert.ok(json.imports['react']);
assert.ok(json.imports['react'].includes('16'));
