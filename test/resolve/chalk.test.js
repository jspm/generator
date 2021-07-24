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
      '../../node_modules/ansi-styles/': { 'color-convert': '../../node_modules/color-convert/index.js' },      
      '../../node_modules/chalk/': {
        'ansi-styles': '../../node_modules/ansi-styles/index.js',
        'supports-color': '../../node_modules/supports-color/browser.js'
      },
      '../../node_modules/color-convert/': { 'color-name': '../../node_modules/color-name/index.js' }
    }
  });
}
