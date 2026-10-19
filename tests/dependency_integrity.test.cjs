const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const manifest = JSON.parse(fs.readFileSync('security/dependencies.json','utf8'));
for (const file of manifest.vendored) {
  if(file.path.includes('/jspdf/')) assert.equal(file.version,'4.2.1','Do not restore the vulnerable jsPDF version');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'),file.sha256,file.path);
}
for (const name of ['app/index.html','app/final_test.html']) {
  const source=fs.readFileSync(name,'utf8');
  for(const file of manifest.cdn) assert.ok(source.includes(`src="${file.url}" integrity="${file.integrity}" crossorigin="anonymous"`),name+' must pin CDN integrity');
}
const maker=fs.readFileSync('dist/solbook_question_maker_portable/app/solbook_question_maker.html','utf8');
assert.ok(maker.includes('vendor/jspdf/jspdf.umd.min.js?v=4.2.1'),'Invalidate old cached jsPDF bundles');
assert.ok(!/pdf\.(?:html|addJS|addMetadata|createAnnotation|addField|loadFile|addSvgAsImage)\s*\(/.test(maker),'New jsPDF API use needs advisory reachability review');
assert.deepEqual([...maker.matchAll(/pdf\.output\(([^)]+)\)/g)].map(m=>m[1]),['"blob"','"blob"']);
for(const name of ['index.html','app/index.html','app/final_test.html','app/general_exam.html']){
  const source=fs.readFileSync(name,'utf8');
  assert.ok(source.includes('data-workspace-shell'),name+' must mount shared navigation');
  assert.ok(!/문제 초안[를가와]/.test(source),name+' teacher-facing particles');
}
console.log(`PASS: ${manifest.vendored.length} local vendor hashes, ${manifest.cdn.length} CDN integrity pins and blob output contract`);
