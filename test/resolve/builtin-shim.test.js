import { Generator } from '@jspm/generator';
import assert from 'assert';

if (typeof document === 'undefined') {
  const generator = new Generator({
    stdlib: new URL('../../jspm-core/', import.meta.url),
    mapUrl: import.meta.url,
    defaultProvider: 'nodemodules'
  });

  // await generator.traceInstall('./cjspkg/mod.js');
  await generator.traceInstall('./cjspkg/mod-shim.js');

  const json = generator.getMap();

  assert.deepStrictEqual(json, {
    scopes: {
      './cjspkg/': {
        'process/': './cjspkg/node_modules/process/index.js',
      }
    }
  });
}
