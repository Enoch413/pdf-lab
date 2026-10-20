const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
process.chdir(root);
for (const file of ['app/index.html', 'app/final_test.html', 'app/general_exam.html',
  'dist/solbook_question_maker_portable/app/solbook_question_maker.html']) {
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(match[1]) && match[2].trim()) new vm.Script(match[2], { filename: file });
  }
}
for (const file of ['app/firebase_helpers.js','app/answer_editor.js','app/workspace_ui.js','app/workspace_shell.js','app/hanbujang_canonical.js','app/solbook_text_renderer.js','app/problem_page_layout.js']) {
  new vm.Script(fs.readFileSync(file,'utf8'), {filename:file});
}
console.log('PASS: authored JavaScript syntax');
for (const file of ['dependency_integrity', 'firebase_helpers', 'check_contract', 'check_response_retry', 'student_identity', 'student_sync', 'local_replacement', 'answer_edit', 'workspace_ui', 'workspace_shell',
  'json_retry_series', 'solbook_text_renderer', 'hanbujang_contract', 'jspdf_output']) {
  const result = spawnSync(process.execPath, [`tests/${file}.test.cjs`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const python = spawnSync(process.env.PDFLAB_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', '*_test.py'], { stdio: 'inherit' });
if (python.error) throw python.error;
if (python.status !== 0) process.exit(python.status || 1);
console.log('PASS: all public offline regression checks');
