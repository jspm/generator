import { Generator } from '@jspm/generator';

const noTs = !process.env.TS;

const generator = new Generator({
  mapUrl: 'about:blank',
  inputMap: noTs ? {
    imports: {
      '@babel/core': 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.8/nodelibs/@empty.js',
      '@babel/preset-typescript': 'https://ga.jspm.io/npm:@jspm/core@2.0.0-beta.8/nodelibs/@empty.js'
    }
  } : {}
});

await generator.install('@jspm/generator');


const json = generator.getMap();
console.log(JSON.stringify(json, null, 2));
