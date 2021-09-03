import { Generator } from '@jspm/generator';
import { readFile } from 'fs/promises';

const noTs = !process.env.TS;

const generator = new Generator({
  mapUrl: 'about:blank',
  inputMap: noTs ? {
    imports: {
      '@babel/core': 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/@empty.js',
      '@babel/preset-typescript': 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.10/nodelibs/@empty.js'
    }
  } : {}
});

const { version } = JSON.parse(await readFile(new URL('package.json', import.meta.url)));

await generator.install(`@jspm/generator@${version}`);


const json = generator.getMap();
console.log(JSON.stringify(json, null, 2));
