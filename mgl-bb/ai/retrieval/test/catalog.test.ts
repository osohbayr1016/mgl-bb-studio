/**
 * Мэдлэгийн сангийн каталог (`retrieval/src/catalog.ts`) — «чамд ямар норм байгаа вэ» / «X юуны тухай вэ».
 *
 * ⚠️ Бодит pack/ (БНбД 31-17-10, git-д байгаа) :memory: санд шингээж хэмжинэ:
 *   • жагсаалт баримт бүрийн код · нэр · төлөв · тоо өгнө, заалтын ТЕКСТ огт өгөхгүй;
 *   • нэг баримтын тойм бүлгүүдийг эх дарааллаар, заалтын мужтай, мета хэсэггүй;
 *   • код alias-аар (зайгүй, латин) таарна; байхгүй код `not_found`, зохиогдохгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { normCatalog, catalogInventory, catalogDocument } from '../src/catalog.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..', '..', 'norm-dataset', 'documents', 'BNbD_31-17-10', 'pack');

const db = openKnowledgeDb({ path: ':memory:' });
ingestDataset(db, PACK);

test('catalog · inventory — нэг баримт, код/нэр/төлөв/тоо; заалтын текст байхгүй', () => {
  const inv = catalogInventory(db);
  assert.equal(inv.kind, 'inventory');
  assert.equal(inv.documents.length, 1);
  const d = inv.documents[0]!;
  assert.equal(d.code, 'БНбД 31-17-10');
  assert.ok(d.title_mn.length > 5);
  assert.ok(d.chunks >= 700 && d.clauses >= 550, `${d.chunks}/${d.clauses}`);
  assert.equal(inv.counts.documents, 1);
  assert.ok(inv.counts.chunks >= 700);
  // Заалтын текст гарах талбар огт байхгүй.
  assert.deepEqual(Object.keys(d).filter((k) => /text|body|content/.test(k)), []);
});

test('catalog · document — бүлгүүд эх дарааллаар, заалтын муж тоогоор эрэмбэлэгдсэн, мета хэсэггүй', () => {
  const doc = catalogDocument(db, 'БНбД 31-17-10');
  assert.equal(doc.kind, 'document');
  if (doc.kind !== 'document') return;
  assert.equal(doc.document.code, 'БНбД 31-17-10');
  assert.ok(doc.sections.length >= 5, `sections ${doc.sections.length}`);
  assert.ok(doc.sections_total >= doc.sections.length);
  for (const s of doc.sections) {
    assert.ok(s.path.length > 0 && s.n > 0);
    assert.doesNotMatch(s.path, /^(legal status|source integrity)$/i);
    if (s.clause_from && s.clause_to) {
      const a = s.clause_from.split('.').map(Number);
      const b = s.clause_to.split('.').map(Number);
      assert.ok(a[0]! <= b[0]!, `${s.path}: ${s.clause_from} > ${s.clause_to}`);
    }
  }
  // Заалтын агуулга бүтцэд байхгүй.
  assert.equal(JSON.stringify(doc.sections).includes('text_mn'), false);
});

test('catalog · код alias/зайгүй хэлбэрээр таарна; байхгүй код → not_found (зохиогдохгүй)', () => {
  assert.equal(normCatalog(db, 'bnbd 31-17-10').kind, 'document');
  assert.equal(normCatalog(db, 'БНбД31-17-10').kind, 'document');
  const nf = normCatalog(db, 'БНбД 99-99-99');
  assert.equal(nf.kind, 'not_found');
  if (nf.kind === 'not_found') {
    assert.equal(nf.code, 'БНбД 99-99-99');
    assert.equal(nf.registry, null);
  }
  // Богино код санамсаргүй таарахгүй.
  assert.equal(normCatalog(db, 'бд').kind, 'not_found');
  // Хоосон код = жагсаалт.
  assert.equal(normCatalog(db, '').kind, 'inventory');
  assert.equal(normCatalog(db, null).kind, 'inventory');
});
