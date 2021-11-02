import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: new URL('../../', import.meta.url),
  defaultProvider: 'nodemodules'
});

await generator.install('lit-element');
await generator.install('lit-html');

const json = generator.getMap();

assert.strictEqual(json.imports['lit-element'], './node_modules/lit-element/lit-element.js');
assert.strictEqual(json.scopes['./']['lit-html/lib/shady-render.js'], './node_modules/lit-html/lib/shady-render.js');
assert.strictEqual(json.scopes['./']['lit-html/lit-html.js'], './node_modules/lit-html/lit-html.js');
