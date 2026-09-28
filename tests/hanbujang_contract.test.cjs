const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../app/hanbujang_canonical.js');
const C = globalThis.PDFLabCanonical;
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/hanbujang-contract/CANONICAL_SCHEMA.json'), 'utf8'));
// The delivered contract uses only these JSON Schema keywords. Refuse silently unsupported keywords.
function check(value, rule, location = '$') {
  for (const key of Object.keys(rule)) assert(['$schema','$id','title','type','additionalProperties','required','properties','items','minimum','enum'].includes(key), 'Unimplemented schema keyword '+key);
  if (rule.type === 'object') {
    assert(value && typeof value === 'object' && !Array.isArray(value), location);
    for (const key of rule.required || []) assert(Object.hasOwn(value,key), location+'.'+key);
    if (rule.additionalProperties === false) for (const key of Object.keys(value)) assert(Object.hasOwn(rule.properties,key),location+'.'+key);
    for (const [key,child] of Object.entries(rule.properties || {})) if (Object.hasOwn(value,key)) check(value[key],child,location+'.'+key);
  } else if (rule.type === 'array') { assert(Array.isArray(value),location);value.forEach((v,i)=>check(v,rule.items,location+'['+i+']')); }
  else if (rule.type === 'integer') assert(Number.isInteger(value),location);
  else assert.equal(typeof value,rule.type,location);
  if (rule.minimum !== undefined) assert(value >= rule.minimum,location);
  if (rule.enum) assert(rule.enum.includes(value),location);
}
for (const name of ['P05_CANONICAL_ACTUAL','HANBUJANG_SYNTHETIC_7']) {
  const input=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/hanbujang',name+'.json'),'utf8'));
  check(input,schema); C.validate(input);
  const before=JSON.stringify(input);C.validate(input);assert.equal(JSON.stringify(input),before);
  console.log('PASS schema + semantic groups + nonmutation: '+name+' ('+input.problems.length+')');
}
const rendered=C.inline('left [[u:[working / to work]]] right [[unknown:<img>]] [[u:unfinished');
assert.match(rendered.html,/<\/u> right/);assert(!rendered.html.includes('<img>'));assert.equal(rendered.warnings.length,2);
console.log('PASS nested marker boundaries and escaped unsupported tokens');
