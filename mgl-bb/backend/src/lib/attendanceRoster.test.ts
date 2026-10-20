/**
 * `lib/attendanceRoster.ts`-ийн тест.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { attendanceRosterSql } = await import('./attendanceRoster.ts');
const { resetOrgConfig, orgConfigFromEnv, setOrgConfig } = await import('./orgConfig.ts');

test('attendanceRosterSql: is_support, client, CEO шүүlt агуулна', () => {
  resetOrgConfig();
  assert.equal(
    attendanceRosterSql('u'),
    "u.status = 'active' AND u.role != 'client' AND u.is_support = 0 AND u.id != 2",
  );
  assert.equal(
    attendanceRosterSql(),
    "u.status = 'active' AND u.role != 'client' AND u.is_support = 0 AND u.id != 2",
  );
});

test('attendanceRosterSql: CEO тохируулаагүй бол id шүүlt байхгүй', () => {
  resetOrgConfig();
  setOrgConfig(orgConfigFromEnv({ ORG_CEO_USER_ID: 'none' }));
  assert.match(attendanceRosterSql('x'), /x\.is_support = 0/);
  assert.match(attendanceRosterSql('x'), /1=1/);
  assert.doesNotMatch(attendanceRosterSql('x'), /x\.id !=/);
  resetOrgConfig();
});
