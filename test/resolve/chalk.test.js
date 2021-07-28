import { Generator } from '@jspm/generator';
import assert from 'assert';

if (typeof document === 'undefined') {
  const generator = new Generator({
    mapUrl: import.meta.url,
    defaultProvider: 'nodemodules'
  });

  await generator.install('chalk');

  const json = generator.getMap();

  assert.deepStrictEqual(json, {
    imports: {
      '../../node_modules/chalk/source/templates': '../../node_modules/chalk/source/templates.js',
      '../../node_modules/chalk/source/util': '../../node_modules/chalk/source/util.js',
      '../../node_modules/color-convert/conversions': '../../node_modules/color-convert/conversions.js',        
      '../../node_modules/color-convert/route': '../../node_modules/color-convert/route.js',
      chalk: '../../node_modules/chalk/source/index.js'
    },
    scopes: {
      '../../node_modules/ansi-styles/': {
        buffer: '../../node_modules/@jspm/core/nodelibs/buffer.js',
        'color-convert': '../../node_modules/color-convert/index.js',
        process: '../../node_modules/@jspm/core/nodelibs/process.js'
      },
      '../../node_modules/chalk/': {
        'ansi-styles': '../../node_modules/ansi-styles/index.js',
        buffer: '../../node_modules/@jspm/core/nodelibs/buffer.js',
        process: '../../node_modules/@jspm/core/nodelibs/process.js',
        'supports-color': '../../node_modules/supports-color/browser.js'
      },
      '../../node_modules/color-convert/': {
        buffer: '../../node_modules/@jspm/core/nodelibs/buffer.js',
        'color-name': '../../node_modules/color-name/index.js',
        process: '../../node_modules/@jspm/core/nodelibs/process.js'
      },
      '../../node_modules/color-name/': {
        buffer: '../../node_modules/@jspm/core/nodelibs/buffer.js',
        process: '../../node_modules/@jspm/core/nodelibs/process.js'
      },
      '../../node_modules/supports-color/': {
        buffer: '../../node_modules/@jspm/core/nodelibs/buffer.js',
        process: '../../node_modules/@jspm/core/nodelibs/process.js'
      }
    }
  });
}
