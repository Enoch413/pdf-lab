const assert = require('node:assert/strict');
const app = require('./app_vm.cjs')(), c = app.context;
for (const name of ['LIBRARY_IMPORT_STORE','LIBRARY_PROBLEM_STORE','LIBRARY_EXAM_STORE','LIBRARY_EXAM_ITEM_STORE','LIBRARY_CHECK_SET_STORE','LIBRARY_WORK_STORE']) app.constant(name);
c.state = { libraryCache: { imports:[{sourceId:'remote',importedAt:1}], problemRecords:[{kind:'problem',recordId:'remote',textbookName:'QA',passageKey:'P'}],
  localImports:[],localProblemRecords:[],examSets:[],problemAssetCache:{cached:true} } };
c.elements = {};
c.calls = []; c.remoteReads = 0;
app.run(`loadAllRecordsFromStore=async store=>{calls.push(store);return []};
  loadSharedLibrarySnapshotFromFirebase=async()=>{remoteReads++;return {imports:[],problemRecords:[]}};
  loadFirebaseStudentRetryOperationalSnapshot=async()=>({examSets:[],examItems:[],savedWorks:[]});
  shouldUseFirebaseStudentRetryAsPrimaryStore=()=>false;isSharedFirebaseLibraryActive=()=>false;
  populateStoredTextbookOptions=populateLibrarySyncSourceOptions=updateTextbookSummary=updateLibraryStorageUi=updateDeleteTextbookUi=
  renderExamLibraryList=renderExamHistoryList=renderExamCheckSetList=renderSavedWorkLists=renderExamSlots=renderLibraryTextEditor=()=>{};
  isLibraryWorkspaceMode=()=>false;getRecordSourceLabel=()=>'';formatTimestamp=()=>'';
  cloneProblemRecordWithRepairedOcrAnswer=record=>record;`);
app.constant('DEFAULT_LIBRARY_SOURCE_KEY');
(async()=>{
  const records=c.state.libraryCache.problemRecords;
  await app.run('refreshLibrarySummary({retainLibrary:true})');
  assert.equal(c.remoteReads,0,'local CHECK/history writes cannot download the entire shared library');
  assert.equal(c.calls.length,4,'only changing history, CHECK and work stores are read');
  assert.equal(c.state.libraryCache.problemRecords,records,'retain the exact array so lookup indexes remain valid');
  assert.equal(c.state.libraryCache.imports[0].sourceId,'remote','remote-only questions must not disappear in a local refresh');
  c.calls=[];
  await app.run('refreshLibrarySummary()');
  assert.equal(c.remoteReads,1,'explicit/full refresh still retrieves remote edits/deletions');
  assert.equal(c.calls.length,6);
  assert.equal(c.state.libraryCache.problemRecords.length,0);
  console.log('PASS: local refresh preserves remote-only questions/indexes with 0 full-library reads, explicit refresh retrieves fresh remote data');
})().catch(error=>{console.error(error);process.exitCode=1});
