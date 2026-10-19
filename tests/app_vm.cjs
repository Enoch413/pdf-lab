// Exercise app functions without startup, browser storage, or Firebase access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
module.exports = function loadApp(file = 'app/index.html', globals = {}) {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const context = vm.createContext({ console, TextEncoder, ...globals });
  for (const script of ['app/hanbujang_canonical.js', 'app/solbook_text_renderer.js', 'app/answer_editor.js', 'app/firebase_helpers.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, script), 'utf8'), context);
  }
  vm.runInContext([...html.matchAll(/^    (?:async )?function \w+\([^]*?^    }\r?$/gm)].map(m => m[0]).join('\n'), context);
  const constants = new Map([...html.matchAll(/^    const (\w+) = [^]*?;\r?$/gm)].map(m => [m[1], m[0].replace('const ', 'var ')]));
  function run(code) {
    // Preload constants before side-effectful async calls; do not replay mutations.
    return vm.runInContext(code, context);
  }
  function constant(name) {
    if (!constants.has(name)) throw new Error('Unknown app constant: ' + name);
    for (let attempts = 0; attempts < 150; attempts++) {
      try { return run(constants.get(name)); }
      catch (error) {
        const dependency = /^(\w+) is not defined/.exec(error.message)?.[1];
        if (!constants.has(dependency)) throw error;
        constant(dependency);
      }
    }
    throw new Error('Unresolved constant: ' + name);
  }
  function pure(code) {
    for (let attempts = 0; attempts < 150; attempts++) {
      try { return run(code); } catch (error) {
        const name = /^(\w+) is not defined/.exec(error.message)?.[1];
        if (!constants.has(name)) throw error;
        constant(name);
      }
    }
    throw new Error('Unresolved pure function dependency');
  }
  return { context, run, constant, pure, html };
};
