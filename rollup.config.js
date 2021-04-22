export default {
  input: ['lib/generator.js'],
  output: {
    dir: 'dist',
    format: 'esm'
  },
  // disable external module warnings
  // (JSPM / the import map handles these for us instead)
  onwarn (warning, warn) {
    if (warning.code === 'UNRESOLVED_IMPORT')
      return;
    warn(warning);
  }
};
