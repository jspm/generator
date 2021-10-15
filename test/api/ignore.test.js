import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator({
  mapUrl: import.meta.url,
  inputMap: {
    "imports": {
      "react": "./location/that/cant/be/traced.js"
    }
  },
  ignore: ['react'],
  env: ['production', 'browser', 'module']
});

await generator.install('@react-three/fiber@7.0.15')

const json = generator.getMap();

console.log(json)

assert.deepEqual(json, {
  "imports": {
    "react": "./location/that/cant/be/traced.js",
    "@react-three/fiber": "https://ga.jspm.io/npm:@react-three/fiber@7.0.15/dist/react-three-fiber.esm.js",
  },
  "scopes": {
    "https://ga.jspm.io/": {
      "debounce": "https://ga.jspm.io/npm:debounce@1.2.1/index.js",
      "fast-deep-equal": "https://ga.jspm.io/npm:fast-deep-equal@3.1.3/index.js",
      "object-assign": "https://ga.jspm.io/npm:object-assign@4.1.1/index.js",
      "react-merge-refs": "https://ga.jspm.io/npm:react-merge-refs@1.1.0/dist/index.js",
      "react-reconciler": "https://ga.jspm.io/npm:react-reconciler@0.26.2/index.js",
      "react-use-measure": "https://ga.jspm.io/npm:react-use-measure@2.0.4/dist/web.cjs.js",
      "scheduler": "https://ga.jspm.io/npm:scheduler@0.20.2/index.js",
      "three": "https://ga.jspm.io/npm:three@0.133.1/build/three.module.js",
      "use-asset": "https://ga.jspm.io/npm:use-asset@1.0.4/dist/index.cjs.js",
      "zustand": "https://ga.jspm.io/npm:zustand@3.5.13/esm/index.js",
      "zustand/shallow": "https://ga.jspm.io/npm:zustand@3.5.13/esm/shallow.js"
    }
  }
});
