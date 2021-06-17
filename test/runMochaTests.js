import '@jspm/generator';

// keepalive
setInterval(() => {
  fetch('/tests/ping');
}, 3000);

(async () => {
  const tests = await (await fetch('/tests/list')).json();

  mocha.setup('tdd');
  mocha.set
  mocha.allowUncaught();
  self.assert = function (val) {
    equal(!!val, true);
  };
  assert.equal = equal;
  assert.ok = assert;
  function equal (a, b) {
    if (a !== b)
      throw new Error('Expected "' + a + '" to be "' + b + '"');
  }
  self.fail = function (msg) {
    throw new Error(msg);
  };

  suite('Browser Tests', async function () {
    this.timeout(30000);
    for (const name of tests) {
      if (name.startsWith('deno'))
        continue;
      test(name, async function () {
        await import('./' + name + '.js');
      });
    }
  });

  mocha.run(function (failures) {
    fetch(failures ? '/error?' + failures : '/done');
  });
})();
