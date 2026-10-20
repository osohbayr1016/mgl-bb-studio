export const FAILURE_STAGES = [
  'LANGUAGE','INTENT','TURN_PLANNING','TOOL_SELECTION','TOOL_EXECUTION','RETRIEVAL',
  'EVIDENCE_RELEVANCE','CURRENTNESS','REASONING','GENERATION','CONTRACT','VALIDATION',
  'REPAIR','TRANSPORT','UNKNOWN',
];

export function classifyFailure(caseDef, execution, scored) {
  if (!execution) return { stage: 'UNKNOWN', reason: 'no execution record' };
  if (execution.status === 'BLOCKED') return { stage: 'TRANSPORT', reason: execution.blocked_by ?? 'dependency unavailable' };
  if (execution.error) {
    const code = String(execution.error.code ?? execution.error.message ?? execution.error);
    if (/retriev|knowledge|norm/i.test(code)) return { stage: 'RETRIEVAL', reason: code };
    if (/tool|erp/i.test(code)) return { stage: 'TOOL_EXECUTION', reason: code };
    if (/generat|model|repetition/i.test(code)) return { stage: 'GENERATION', reason: code };
    return { stage: 'TRANSPORT', reason: code };
  }
  const intentExpected = caseDef.expected?.intent;
  const intentActual = execution.trace?.intent;
  if (intentExpected && intentExpected !== intentActual) {
    return { stage: 'INTENT', expected: intentExpected, actual: intentActual ?? null };
  }
  if (execution.trace?.retrieval_ok === false) return { stage: 'RETRIEVAL', reason: execution.trace.retrieval_reason ?? 'retrieval mismatch' };
  if (execution.trace?.evidence_relevant === false) return { stage: 'EVIDENCE_RELEVANCE', reason: execution.trace.evidence_reason ?? 'wrong subject' };
  if (execution.trace?.currentness_ok === false) return { stage: 'CURRENTNESS', reason: execution.trace.currentness_reason ?? 'currentness mismatch' };
  if (scored?.checks?.some((x) => x.kind === 'language' && !x.ok)) return { stage: 'LANGUAGE', reason: 'response language mismatch' };
  if (scored?.checks?.some((x) => x.kind === 'decision' && !x.ok)) return { stage: 'REASONING', reason: 'semantic decision mismatch' };
  if (execution.raw_validation?.ok === false && !execution.repair_attempted) return { stage: 'VALIDATION', reason: 'raw answer invalid' };
  if (execution.repair_attempted && scored?.status === 'FAIL') return { stage: 'REPAIR', reason: 'repair did not recover the case' };
  if (scored?.status === 'FAIL') return { stage: 'REASONING', reason: 'semantic requirements not met' };
  return null;
}
