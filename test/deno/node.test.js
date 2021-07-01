import { Generator } from '@jspm/generator';
import { denoExec } from '#test/deno';

const generator = new Generator({
  mapUrl: 'about:blank',
  stdlib: new URL('../../jspm-core/', import.meta.url),
  env: ['production', 'node', 'deno', 'module']
});

await generator.install('express');

await denoExec(generator.getMap(), `
  import express from 'express';

  console.log(express);
`);
