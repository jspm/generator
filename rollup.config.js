import { pathToFileURL, fileURLToPath } from 'url';

export default {
  input: {
    'generator': 'lib/generator.js',
    // TODO: internal module builds should be automatically iterated and built
    'fetch': 'lib/common/fetch.js',
    'fetch-node': 'lib/common/fetch-node.js'
  },
  output: {
    dir: 'dist',
    format: 'esm'
  },
  plugins: [{
    resolveId (specifier, parent) {
      if (parent && !specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/'))
        return { id: specifier, external: true };
      return fileURLToPath(new URL(specifier, parent ? pathToFileURL(parent) : import.meta.url));
    }
  }],
  // disable external module warnings
  // (JSPM / the import map handles these for us instead)
  onwarn (warning, warn) {
    if (warning.code === 'UNRESOLVED_IMPORT')
      return;
    warn(warning);
  }
};
