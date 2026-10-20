import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl, summarizeNormCoverage } from './coverage-report.mjs';

test('coverage counts unverified status, missing links and parsed matched documents without promoting legal status',()=>{
  const l1=[
    {canonical_code:'A',status:'ACTIVE',source_pdf_url:'https://mcis.gov.mn/a.pdf'},
    {canonical_code:'B',status:'STATUS_REQUIRES_VERIFICATION',source_url:'https://www1.gazar.gov.mn/register.pdf#page=1'},
    {canonical_code:'C',status:'SUPERSEDED',source_url:'javascript:1'},
  ];
  const curated=[
    {canonical_code:'A',priority:'P0',status:'ACTIVE',deep_ingestion_status:'PARSED',document_dir:'documents/Doc_A'},
    {canonical_code:'B',priority:'P1',status:'ACTIVE',deep_ingestion_status:'NOT_STARTED'},
    {canonical_code:'C',priority:'P1',status:'SUPERSEDED'},
  ];
  const s=summarizeNormCoverage({l1,curated,documents:['Doc_A']});
  assert.equal(s.l1.registry_rows,3);
  assert.equal(s.l1.official_or_candidate_source_url,2);
  assert.equal(s.l1.source_url_missing,1);
  assert.equal(s.l1.status_not_marked_active,2);
  assert.equal(s.curated.matched_parsed_documents,1);
  assert.deepEqual(s.curated.parsed_document_codes,['A']);
  assert.deepEqual(s.curated.active_without_matching_parsed_dir,['B']);
  assert.equal(s.curated.priorities.P1,2);
  assert.match(s.meaning,/not live legal completeness/);
});

test('malformed JSONL refuses to report success',()=>{
  assert.deepEqual(parseJsonl('{"code":"X"}\n'),[{code:'X'}]);
  assert.throws(()=>parseJsonl('{"a":1}\nbroken','fixture'),/fixture line 2/);
  assert.throws(()=>parseJsonl('[]','fixture'),/not an object/);
});
