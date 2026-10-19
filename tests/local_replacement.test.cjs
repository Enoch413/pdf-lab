const assert = require('node:assert/strict');
const load = require('./app_vm.cjs');
const {context:c,run,constant} = load(undefined,{IDBKeyRange:{only:value=>value}});
for(const key of ['LIBRARY_IMPORT_STORE','LIBRARY_PROBLEM_STORE','LIBRARY_PROBLEM_ASSET_STORE']) constant(key);
async function replace(failAt) {
  const old={recordId:'old',sourceId:'book',generation:'old'};
  const stored=new Map([['old',old]]);let transactions=0;
  c.state={libraryCache:{problemAssetCache:{old:{cached:true}}}};
  c.rows=Array.from({length:24},(_,i)=>({recordId:'new-'+i,sourceId:'book'}));
  c.db={transaction() {
    transactions++;const stage=new Map(stored);let puts=0,aborted=false,resolve,reject;
    const tx={done:new Promise((a,b)=>{resolve=a;reject=b;}),abort(){aborted=true;reject(new Error('Injected quota failure'));}};
    tx.objectStore=()=>({put(row){if(++puts===failAt)throw new Error('QuotaExceededError');stage.set(row.recordId||'import',row);},
      delete:id=>stage.delete(id),index:()=>({openCursor(){
        const listeners={};const request={addEventListener:(name,fn)=>{listeners[name]=fn;}};
        const advance=()=>queueMicrotask(()=>{
          const value=stage.get('old');request.result=value?{value,delete:()=>stage.delete('old'),continue:advance}:null;
          listeners.success();
          if(!request.result&&!aborted){stored.clear();stage.forEach((v,k)=>stored.set(k,v));resolve();}
        });advance();return request;
      }})});return tx;
  }};
  run('openLibraryDb=async()=>db; idbTransactionDone=tx=>tx.done; setStatus=()=>{}');
  let error;try{await run('saveSourceProblemsToLocalLibrary({sourceId:"book"},rows)');}catch(e){error=e;}
  if(failAt){assert.ok(error);assert.equal(stored.get('old'),old);assert.equal(stored.size,1);assert.ok(c.state.libraryCache.problemAssetCache.old);}
  else{assert.ifError(error);assert(!stored.has('old'));assert(stored.has('new-23'));assert(!c.state.libraryCache.problemAssetCache.old);}
  assert.equal(transactions,1,'Replacement must share one commit/rollback boundary');
}
(async()=>{await replace(14);await replace(0);console.log('PASS: failed replacement rolls back old records/metadata/cache; successful replacement commits once');})()
 .catch(e=>{console.error(e);process.exitCode=1;});
