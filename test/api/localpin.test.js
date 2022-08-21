import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  defaultProvider: 'jspm',
  env: ['production', 'browser']
});

await generator.traceInstall('./local/pkg/jquery.js');
const json = generator.getMap();

assert.ok(json.imports['jquery']);
