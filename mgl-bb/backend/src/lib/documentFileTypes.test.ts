import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileExt, isAllowedDocFile, withOriginalExt } from './documentFileTypes.ts';

// 2026-09-03: бодлого ЦАГААН жагсаалтаас ХАР жагсаалт болов — серверийн
// бүтэн хавтсыг оруулах учир ажлын бүх файл орох ёстой.
test('isAllowedDocFile accepts every work file', () => {
  for (const name of [
    'a.pdf',
    'a.PDF',
    'a.doc',
    'a.docx',
    'a.xlsx',
    'a.pptx',
    'a.dwg',
    'a.rvt',
    'a.ifc',
    'a.png',
    'a.jpg',
    'a.zip',
    'a.rar',
    'a.txt',
    'README',
  ]) {
    assert.equal(isAllowedDocFile(name), true, name);
  }
});

test('isAllowedDocFile blocks executables and script/markup files', () => {
  for (const name of [
    'setup.exe',
    'setup.EXE',
    'a.msi',
    'a.bat',
    'a.cmd',
    'a.ps1',
    'a.vbs',
    'a.js',
    'a.jar',
    'a.dll',
    'a.lnk',
    'a.sh',
    'a.php',
    // /media нь нийтэд ил домэйн тул фишинг хуудас байршуулахаас сэргийлнэ.
    'a.html',
    'a.htm',
    'a.svg',
  ]) {
    assert.equal(isAllowedDocFile(name), false, name);
  }
});

test('fileExt and withOriginalExt keep the original suffix', () => {
  assert.equal(fileExt('Report.DOCX'), 'docx');
  assert.equal(withOriginalExt('Нэр', 'old.pdf'), 'Нэр.pdf');
  assert.equal(withOriginalExt('Нэр.pdf', 'old.pdf'), 'Нэр.pdf');
  assert.equal(withOriginalExt('Нэр.PDF', 'old.pdf'), 'Нэр.PDF');
});
