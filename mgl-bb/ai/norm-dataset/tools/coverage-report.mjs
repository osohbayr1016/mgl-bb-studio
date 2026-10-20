#!/usr/bin/env node
/**
 * NORM-FIRST coverage ledger: catalogue/verified-status/deep-ingestion gaps.
 * Offline and read-only: does not fetch URLs, approve norms, or train a model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseJsonl(text, label = 'JSONL') {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line, i) => {
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('not an object');
      return row;
    } catch (error) {
      throw Error(`${label} line ${i + 1}: ${String(error)}`);
    }
  });
}

function usableSource(record) {
  const links = [
    record.source_pdf_url, record.official_pdf_url, record.official_detail_url,
    record.source_url, record.legal_source_url,
  ];
  return links.some((url) => {
    if (typeof url !== 'string') return false;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch { return false; }
  });
}

export function summarizeNormCoverage({ l1 = [], curated = [], documents = [] }) {
  const statuses = {};
  let l1WithSource = 0, unverified = 0, uniqueCodes = new Set();
  for (const row of l1) {
    const st = String(row.status ?? 'UNKNOWN');
    statuses[st] = (statuses[st] ?? 0) + 1;
    if (usableSource(row)) l1WithSource++;
    if (st !== 'ACTIVE') unverified++;
    if (typeof row.canonical_code === 'string' && row.canonical_code.trim()) uniqueCodes.add(row.canonical_code.trim());
  }
  const covered = [];
  const notParsed = [];
  const byPriority = {};
  const curatedStatuses = {};
  for (const row of curated) {
    const name = String(row.canonical_code ?? row.code ?? '');
    const priority = String(row.priority ?? 'UNPRIORITIZED');
    const status = String(row.status ?? 'UNKNOWN');
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    curatedStatuses[status] = (curatedStatuses[status] ?? 0) + 1;
    if (row.deep_ingestion_status === 'PARSED' && documents.some((dir) => row.document_dir === `documents/${dir}`)) {
      covered.push(name);
    } else if (status === 'ACTIVE') {
      notParsed.push(name);
    }
  }
  return {
    schema: 'mgl-ai-norm-coverage/1',
    meaning: 'REPO SNAPSHOT ONLY; not live legal completeness, not full-text/approved-clause coverage',
    l1: { registry_rows: l1.length, official_or_candidate_source_url: l1WithSource,
      source_url_missing: l1.length - l1WithSource,
      status_distribution: statuses, status_not_marked_active: unverified,
      distinct_canonical_codes: uniqueCodes.size },
    curated: { records: curated.length, status_distribution: curatedStatuses,
      priorities: byPriority, matched_parsed_documents: covered.length,
      parsed_document_codes: covered.sort(), active_without_matching_parsed_dir: notParsed.sort() },
    source_tree: { document_dirs: [...documents].sort(), document_dir_count: documents.length },
  };
}

export function coverageFromRepo(root = ROOT) {
  const l1Path = path.join(root, 'registry/cdc-2025/registry_with_verified_delta.jsonl');
  const curatedPath = path.join(root, 'registry/norms.jsonl');
  const documentsPath = path.join(root, 'documents');
  const load = (p) => parseJsonl(fs.readFileSync(p, 'utf8'), path.relative(root, p));
  const documents = fs.readdirSync(documentsPath, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  return summarizeNormCoverage({ l1: load(l1Path), curated: load(curatedPath), documents });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = coverageFromRepo();
  if (process.argv.includes('--check') && (report.l1.registry_rows === 0 || report.curated.records === 0)) {
    throw Error('Registry snapshot or curated source catalog is empty');
  }
  console.log(JSON.stringify(report, null, 2));
}
