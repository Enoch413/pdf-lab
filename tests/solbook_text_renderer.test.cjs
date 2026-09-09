const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const moduleText = fs.readFileSync(path.join(root, 'app/solbook_text_renderer.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(moduleText, context);
const renderer = context.PDFLabSolbookText;
const source = fs.readFileSync(path.join(root, 'dist/solbook_question_maker_portable/app/solbook_question_maker.html'), 'utf8');
const reference = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('    const CHOICE_MARKERS ='), source.indexOf('    const state =')) +
  source.slice(source.indexOf('    function escapeHtml('), source.indexOf('    function normalizeDifficulty(')) +
  '\nthis.reference = {normalizeQuestionType, normalizeSolbookMarkers, normalizeChoiceText, renderInlineText};', reference);

const samples = [
  ['밑줄어법', 'We [[u:① learns]] together and [[u:② grow]] steadily.'],
  ['밑줄어휘', 'The [[u:obvious]] benefit was [[u:lasting]].'],
  ['빈칸', 'Learning requires [[blank]] and [[blank:A]].'],
  ['삽입', '[삽입문]\nThis sentence belongs here.\n[본문]\nFirst. [[s]] Next. [[slot]] Last.'],
  ['순서', '[주어진 글]\nOpening.\n(A)\nFirst.\n(B) Second.\n(C) Third.'],
  ['요약', '[본문]\nOriginal passage.\n[요약문]\nIt is [[blank:A]] and [[blank:B]].'],
  ['선택어법', 'They [[box:A:is|are]] ready for [ work / play  ].'],
  ['함축의미', 'The phrase [[u:a bridge to tomorrow]] means hope.'],
  ['주제', '<img src=x onerror=alert(1)> & ordinary text']
];
for (const [type, body] of samples) {
  assert.equal(renderer.normalizeQuestionType(type), reference.reference.normalizeQuestionType(type));
  assert.equal(renderer.normalizeSolbookMarkers(body, type), reference.reference.normalizeSolbookMarkers(body, type));
  assert.equal(renderer.renderInlineText(body, type), reference.reference.renderInlineText(body, type));
}
for (const [type, value] of [
  ['order', '(B)-(A)-(C)'], ['순서', 'C A B'], ['summary', '(A) flexible / (B) practice'],
  ['요약', 'adaptable …… experience'], ['선택어법', '(A) have / (B) which / (C) learning']
]) {
  assert.equal(renderer.normalizeChoiceText(value, type), reference.reference.normalizeChoiceText(value, type).replace(/\u2011/g, '-'));
}
const original = { kind: 'problem', number: 12, problemType: '밑줄어법', textStructure: {
  templateKey: 'objective-body-only', questionText: '12. 다음 글의 어법상 틀린 것은?',
  bodyText: 'They ① [[u:① is]] ready. We ② [[u:work]] together.', choices: []
}};
const before = JSON.stringify(original);
const markup = renderer.render(original);
assert.equal(JSON.stringify(original), before, 'Rendering must not edit saved records');
assert.ok(!markup.includes('① ①'));
assert.ok(!markup.includes('12.'));
assert.ok(markup.includes('① <u>is</u>'));
assert.ok(markup.includes('② <u>work</u>'));
assert.ok(!markup.includes('[['));
const summary = renderer.toQuestion({problemType:'요약', textStructure:{questionText:'요약하시오.', bodyText:'Main.', summaryText:'Summary.', choices:[{text:'one / two'}]}});
assert.equal(summary.body, 'Main.\n\nSummary.');
assert.deepEqual(Array.from(summary.choices), ['one / two']);
assert.ok(renderer.render({stem:'Choose.',body:'Safe.',choices:['and/or (A) is intentional']}).includes('and/or (A) is intentional'));
assert.ok(!renderer.render({stem:'<img onerror="x">',body:'<script>alert(1)</script>'}).includes('<script>'));
assert.equal(renderer.toQuestion({isSubjective:true, problemType:'순서', textStructure:{bodyText:'(A) answer space'}}).type, '');
const shared = renderer.toQuestion({kind:'shared'}, [{type:'stem',text:'Why?'},{type:'body',text:'Shared passage.'}]);
assert.equal(shared.stem, '');
assert.equal(shared.body, 'Why?\n\nShared passage.');
const legacy = renderer.toQuestion({}, [{type:'body',text:'다음 글을 읽고 답하시오. This is the passage.'}]);
assert.equal(legacy.stem, '다음 글을 읽고 답하시오.');
assert.equal(legacy.body, 'This is the passage.');
assert.equal(renderer.toQuestion({stem:'12.5 percent is how much?',body:'Keep numbers.'}).stem, '12.5 percent is how much?');
const sequence = renderer.toQuestion({problemType:'순서',textStructure:{sequenceParts:[{label:'A',text:'First.'},{label:'B',text:'Second.'},{label:'C',text:'(C) Third.'}]}});
assert.equal(sequence.body, '(A) First.\n\n(B) Second.\n\n(C) Third.');
const insertion = renderer.toQuestion({problemType:'삽입',textStructure:{givenText:'Insert this.',bodyText:'Opening.',choices:[{text:'First slot.'}]}});
assert.equal(insertion.choices.length, 0);
assert.ok(insertion.body.includes('① First slot.'));
assert.throws(() => renderer.assertFits([{columns:[{items:[{isOverflow:true,problem:{renderContentMode:'text',number:7}}]}]}]), /7번/);
renderer.assertFits([{columns:[{items:[{isOverflow:true,problem:{renderContentMode:'image'}}]}]}]);
for (const file of ['app/index.html','app/final_test.html']) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1], {filename:file});
  }
  assert.ok(html.includes('./solbook_text_renderer.js?v='));
  assert.ok(html.includes('window.PDFLabSolbookText?.assertFits(layoutMeta.sheets)'));
}
console.log('PASS: Solbook parity, all marker types, safe escaping, structure/legacy adapters, nonmutation, overflow guard, both app scripts.');
