const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./app_vm.cjs');

for (const file of ['app/index.html', 'app/final_test.html', 'app/general_exam.html']) {
  const cssFile = file.includes('final_test') ? 'final_test.css' : 'pdf_problem_template_repacker.css';
  const css = fs.readFileSync('app/' + cssFile, 'utf8');
  for (const suffix of ['', '?v=20261020-1', '#print', '?v=1#print']) {
    const href = './' + cssFile + suffix;
    const window = {
      location: { href: 'https://example.test/pdf-lab/' + file, protocol: 'https:' },
      PDFLabSolbookText: { cssText: '.solbook-body { color: black; }' }
    };
    const stylesheet = { href: new URL(href, window.location.href).href, cssRules: [{ cssText: css }] };
    const document = {
      styleSheets: [{ href: 'https://example.test/workspace_shell.css?v=1', cssRules: [] }, stylesheet],
      querySelectorAll: () => [{ getAttribute: () => href }]
    };
    const app = load(file, { window, document, URL, console: { warn() {} } });
    assert.equal(app.run('getCssTextForStandaloneDocument()'), css, file + suffix + ': export must retain print CSS');
    const html = app.run('buildStandaloneHtmlDocument("<section class=sheet></section>", "시험지")');
    assert(html.includes('size: A4 portrait'), file + ': A4 portrait');
    assert(html.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), file + ': two columns');
    assert(html.includes('max-width: 44mm'), file + ': bounded logo');
    assert(html.includes(window.PDFLabSolbookText.cssText), file + ': text renderer CSS');
    assert(!html.includes('<link rel="stylesheet"'), 'Embedded styles must not require a second request');

    // Unreadable CSSOM and file:// must fall back even when text-renderer CSS exists.
    Object.defineProperty(stylesheet, 'cssRules', { get() { throw new Error('SecurityError'); } });
    for (const protocol of ['https:', 'file:']) {
      window.location.protocol = protocol;
      window.location.href = protocol === 'file:'
        ? 'file:///C:/PDF-LAB/' + file : 'https://example.test/pdf-lab/' + file;
      const fallback = app.run('buildStandaloneHtmlDocument("<section class=sheet></section>", "시험지")');
      const expected = new URL(href, window.location.href).href.replace(/&/g, '&amp;');
      assert(fallback.includes('<link rel="stylesheet" href="' + expected + '">'), file + suffix + ': stylesheet fallback');
      assert(fallback.includes(window.PDFLabSolbookText.cssText));
    }
  }
}
console.log('PASS: all three print exports retain A4, columns and logo CSS with versioned URLs, CSSOM failures and file URLs');
