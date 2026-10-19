const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync('app/workspace_shell.js', 'utf8');
const portable = 'dist/solbook_question_maker_portable/app/';
for (const file of ['workspace_shell.js', 'workspace_shell.css']) {
  assert.deepEqual(fs.readFileSync('app/' + file), fs.readFileSync(portable + file), 'Portable shell must stay in sync');
}
function element(tag) {
  return { tag, children: [], attrs: {}, dataset: {}, classList: { add() {} },
    setAttribute(key, value) { this.attrs[key] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    before(node) { this.previous = node; }, after(node) { this.next = node; },
    scrollIntoView() { this.scrolledIntoView = true; } };
}
const cases = [
  ['index.html', '', 'home'],
  ['app/index.html', '?workspace=exam', 'exam'],
  ['app/index.html', '?workspace=library', 'library'],
  ['app/final_test.html', '', 'final'],
  ['app/general_exam.html', '?workspace=exam', 'general'],
  [portable + 'solbook_question_maker.html', '', 'solbook']
];
for (const prefix of ['http://127.0.0.1:8763/', 'https://example.test/pdf-lab/']) {
  for (const [file, query, page] of cases) {
    const html = fs.readFileSync(file, 'utf8');
    const body = element('body'), header = element('header');
    body.dataset.labPage = html.match(/data-lab-page="([^"]+)"/)[1];
    body.dataset.labRoot = html.match(/data-lab-root="([^"]+)"/)[1];
    const script = html.match(/<script src="([^"]*workspace_shell\.js)[^"]*"><\/script>/);
    assert.ok(script, file + ' must load navigation before app startup');
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), script[1])));
    vm.runInNewContext(source, { URL, location: { href: prefix + file + query }, document: {
      body, querySelector: () => header, createElement: element
    } });
    assert.equal(body.dataset.uiPage, page);
    const [logo, nav] = header.children;
    assert.equal(logo.href, prefix);
    assert.equal(nav.children.length, 5);
    assert.deepEqual(nav.children.map(link => link.textContent), ['반별 출제', '파이널테스트', '문제 라이브러리', '일반 출제', '쏠북메이커']);
    assert.equal(nav.children[4].href, prefix + portable + 'solbook_question_maker.html');
    const active = nav.children.filter(link => link.attrs['aria-current'] === 'page');
    assert.equal(active.length, page === 'home' ? 0 : 1);
    if (active.length) {
      assert.equal(active[0].href, prefix + file + query);
      assert.ok(active[0].scrolledIntoView, 'Current page must be visible in the mobile menu');
    }
    const examLink = nav.children.find(link => link.id === 'openExamWorkspaceLink');
    assert.equal(examLink.href, prefix + (page === 'general' ? 'app/general_exam.html?workspace=exam' : 'app/index.html?workspace=exam'));
    assert.equal(header.previous.href, '#' + header.next.children[0].id, 'Skip link must target the page heading');
  }
}
console.log('PASS: shared navigation, current page, legacy event targets, skip link, subdirectory hosting and portable copies');
