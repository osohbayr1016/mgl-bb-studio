import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure } from './failureStage.mjs';

const c={expected:{intent:'NORMATIVE'}};
const failed={status:'FAIL',checks:[{kind:'decision',ok:false}]};

test('missing or wrong intent is attributed upstream of model reasoning',()=>{
  assert.equal(classifyFailure(c,{status:'EXECUTED',trace:{}},failed).stage,'INTENT');
  assert.equal(classifyFailure(c,{status:'EXECUTED',trace:{intent:'GENERAL_HELP'}},failed).stage,'INTENT');
});

test('retrieval errors are not mistaken for tool errors because they time out',()=>{
  assert.equal(classifyFailure(c,{status:'ERROR',error:{code:'NORM_RETRIEVAL_TIMEOUT'}},failed).stage,'RETRIEVAL');
  assert.equal(classifyFailure(c,{status:'ERROR',error:{code:'ERP_TOOL_TIMEOUT'}},failed).stage,'TOOL_EXECUTION');
});

test('language failure has its own stage',()=>{
  const result=classifyFailure({expected:{}},{status:'EXECUTED',trace:{}},{status:'FAIL',checks:[{kind:'language',ok:false}]});
  assert.equal(result.stage,'LANGUAGE');
});
