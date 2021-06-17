import { Generator } from '@jspm/generator';
import assert from 'assert';

const generator = new Generator();

const { staticDeps, dynamicDeps } = await generator.install('@jspm/generator');
const json = generator.getMap();

console.log(json);
