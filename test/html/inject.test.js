import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('./local/page.html', import.meta.url),
  env: ['production', 'browser']
});

const htmlInjector = await generator.traceHtml(`
<!doctype html>
<script type="module">
import 'react';
</script>
`);

htmlInjector.setImportMap(generator.getMap());

htmlInjector.toString();

