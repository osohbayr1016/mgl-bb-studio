import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier))
      return nextResolve(specifier + '.ts', context);
    return nextResolve(specifier, context);
  },
});

const { renderNormReferenceLinks, withNormReferenceLinks, isOfficialNormUrl } = await import('./normReferenceLinks.ts');
const { parseLocalNormTopicRoute } = await import('./localNorm.ts');

const route = parseLocalNormTopicRoute({
  detected_topics: ['loads'],
  detection: 'exact',
  count: 2,
  results: [
    {registry_id:'1',code:'БНбД 20-04-17',title_mn:'Ачаа ба үйлчлэл',status:'ACTIVE',
      url:'https://mcis.gov.mn/storage/uploads/process/norm.pdf',
      topics:['loads'],router_score:100},
    {registry_id:'2',code:'БД 20-103-99',title_mn:'Нэмэлт лавлах',status:'STATUS_REQUIRES_VERIFICATION',
      url:'https://mcis.gov.mn/main/single/1234',
      topics:['loads'],router_score:20},
    {registry_id:'3',code:'ЗОХИОМОЛ',title_mn:'Javascript link',status:'ACTIVE',
      url:'javascript:alert(1)',topics:['loads'],router_score:99},
  ],
});

const original = {
  version: 'tfc-2', answerMode:'grounded', risk:'medium',
  facts:[{id:'irrelevant',value:'unrelated'}], allowedNumbers:[42],
  allowedCategories:['В1'], requiredSentence:'bad closest clause', trailerText:'bad trailer',
  requiredCitations:[], noMatch:false, forbiddenPhrases:[], template:'Unrelated closest paragraph',
  templateOnly:false, taskIndex:null, legacyKind:'norm_refusal',
  reason:'original', norm:null,
};

test('verified topic: link-only template includes exact official URLs and status, not made-up clauses',()=>{
  assert.ok(route);
  const out = renderNormReferenceLinks(route, 'mn-Cyrl');
  assert.match(out, /нормын бүртгэлийн холбоосууд/);
  assert.match(out, /\*\*БНбД 20-04-17\*\*/);
  assert.match(out, /\[MCIS PDF\]\(https:\/\/mcis\.gov\.mn\/storage\/uploads\/process\/norm\.pdf\)/);
  assert.match(out, /БД 20-103-99.*Одоогийн төлөв баталгаажаагүй/);
  assert.doesNotMatch(out, /ЗОХИОМОЛ|javascript:|заалт 3\.1|= 1\.2 м/);
  assert.equal((out.match(/\n- /g)??[]).length,2);
});

test('no matched topic or no safe valid source means no link advice',()=>{
  assert.equal(renderNormReferenceLinks(null,'mn-Cyrl'),null);
  assert.equal(renderNormReferenceLinks({...route, detection:'none'},'mn-Cyrl'),null);
  assert.equal(renderNormReferenceLinks({...route, detectedTopics:[]},'mn-Cyrl'),null);
  assert.equal(renderNormReferenceLinks({...route, results:[]},'mn-Cyrl'),null);
});

test('candidate links replace unsupported nearest-clause answer only when explicitly eligible',()=>{
  const blocked = withNormReferenceLinks(original,route,'mn-Cyrl',false);
  assert.equal(blocked,original);
  const safe = withNormReferenceLinks(original,route,'mn-Cyrl',true);
  assert.equal(safe.answerMode,'refusal');
  assert.equal(safe.risk,'high');
  assert.equal(safe.templateOnly,true);
  assert.equal(safe.noMatch,true);
  assert.equal(safe.requiredSentence,null);
  assert.equal(safe.facts.length,0);
  assert.deepEqual(safe.allowedCategories,[]);
  assert.doesNotMatch(safe.template,/Unrelated closest|bad closest/);
  assert.match(safe.template,/БНбД 20-04-17/);
  assert.match(safe.reason,/norm_reference_links_only/);
});

test('English fallback remains source-only and makes no legal claim for unchecked register entry',()=>{
  const out=renderNormReferenceLinks(route,'en');
  assert.match(out,/related registry links for you to check/);
  assert.match(out,/Current status not verified/);
  assert.doesNotMatch(out,/must be at least|shall be/);
});

test('unsafe and counterfeit official HTTPS domains are never rendered',()=>{
  for(const u of ['https://mcis.gov.mn.evil.example/forged.pdf','https://example.com/fake.pdf','https://legalinfo.mn@evil.example/fake','http://mcis.gov.mn/a.pdf','javascript:alert(1)']){
    assert.equal(isOfficialNormUrl(u),false,u);
  }
  assert.equal(isOfficialNormUrl('https://www1.gazar.gov.mn/upload/register.pdf#page=12'),true);
  assert.equal(isOfficialNormUrl('https://legalinfo.mn/mn/detail/12'),true);
  const spoofed={...route, results:[{...route.results[0],url:'https://mcis.gov.mn.evil.example/a.pdf'}]};
  assert.equal(renderNormReferenceLinks(spoofed,'mn-Cyrl'),null);
});
