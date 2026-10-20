#!/usr/bin/env node
// Generates backend/migrations/0008_seed_employees.sql with all employees
// pre-filled, using a bcryptjs hash of DEFAULT_PASSWORD so users can log in
// immediately. Run once:  node scripts/gen-seed-employees.mjs
//
// All inserts use INSERT OR IGNORE keyed on employee_id so re-running is safe.

import bcrypt from 'bcryptjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PASSWORD = 'mgl2026';
const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

/**
 * Employees grouped by team-code.
 * Each row: [first_name (НЭР), last_name (ОВОГ), employee_id, role, position]
 * Role must be one of: admin, engineer, architect, senior, client
 */
const data = {
  BA: {
    // Ахлах архитекторууд
    senior: [
      ['Билгүүн', 'Бат-Өлзий', 'BLN', 'senior', 'Ахлах архитектор'],
      ['Ганбат', 'Уртнаст', 'GNB', 'senior', 'Ахлах архитектор'],
      ['Эрдэнэжин', 'Бээжин', 'JIN', 'senior', 'Ахлах архитектор'],
    ],
    rest: [
      ['Анударь', 'Сайнбаяр', 'ANU', 'architect', 'Архитектор'],
      ['Ариунзаяа', 'Туул', 'ZYA', 'architect', 'Архитектор'],
      ['Батзул', 'Тайсүрэн', 'BZU', 'architect', 'Архитектор'],
      ['Баярчимэг', 'Даваажамц', 'BYR', 'architect', 'Архитектор'],
      ['Доржсүрэн', 'Сандагдорж', 'DRJ', 'architect', 'Архитектор'],
      ['Дэжидханд', 'Хадбаатар', 'DJK', 'architect', 'Архитектор'],
      ['Лхүндэврэгзэн', 'Аюурзана', 'LHN', 'architect', 'Архитектор'],
      ['Мөнхдүүрэн', 'Өлзийсайхан', 'DUR', 'architect', 'Архитектор'],
      ['Намуундалай', 'Анхбаатар', 'NDA', 'architect', 'Архитектор'],
      ['Намуунзул', 'Ганзориг', 'NMU', 'architect', 'Архитектор'],
      ['Нарангарав', 'Угтахбаяр', 'NKI', 'architect', 'Архитектор'],
      ['Сугархүү', 'Батбаяр', 'SGR', 'architect', 'Архитектор'],
      ['Тилекберди', 'Биахмет', 'BQ', 'architect', 'Архитектор'],
      ['Төгөлдөр', 'Батаа', 'TGU', 'architect', 'Архитектор'],
      ['Тэлмэн', 'Бат-Өлзий', 'TLM', 'architect', 'Архитектор'],
      ['Ууганбаяр', 'Заяабат', 'UGN', 'architect', 'Архитектор'],
      ['Хулан', 'Төмөрчөдөр', 'HLY', 'architect', 'Архитектор'],
      ['Халиун', 'Батболд', 'KHA', 'architect', 'Архитектор'],
      ['Хангай', 'Идэрмөнх', 'KHG', 'architect', 'Архитектор'],
      ['Шаарийбуу', 'Наянбуу', 'SHBU', 'architect', 'Архитектор'],
      ['Энхзул', 'Энхтайван', 'ZUL', 'architect', 'Архитектор'],
    ],
  },
  BB: {
    senior: [
      ['Сайнбаяр', 'Лхагва-Эрдэнэ', 'SNA', 'senior', 'Бүтээцийн ахлах инженер'],
      ['Батзориг', 'Амар', 'BTZ', 'senior', 'Бүтээцийн ахлах инженер'],
    ],
    rest: [
      ['Азжаргал', 'Ариунболд', 'AZA', 'engineer', 'Бүтээцийн инженер'],
      ['Ариунжаргал', 'Батзориг', 'ARN', 'engineer', 'Бүтээцийн инженер'],
      ['Батбилэг', 'Пүрэвжав', 'BBL', 'engineer', 'Бүтээцийн инженер'],
      ['Далайбуян', 'Даваажав', 'DLB', 'engineer', 'Бүтээцийн инженер'],
      ['Лувсандагва', 'Баянмөнх', 'LUD', 'engineer', 'Бүтээцийн инженер'],
      ['Номинчимэг', 'Дорж', 'NOM', 'engineer', 'Бүтээцийн инженер'],
      ['Сувдаа', 'Нармандах', 'SVD', 'engineer', 'Бүтээцийн инженер'],
    ],
  },
  HAS: {
    senior: [['Баярхүү', 'Мөнхбилэг', 'MBX', 'senior', 'Халаалт агаар сэлгэлтийн ахлах инженер']],
    rest: [
      ['Анужин', 'Мөнхбаатар', 'ANN', 'engineer', 'ХАС-ийн инженер'],
      ['Одгэрэл', 'Эрдэнэчимэг', 'ODK', 'engineer', 'ХАС-ийн инженер'],
      ['Өнөржаргал', 'Төрмөнх', 'UNU', 'engineer', 'ХАС-ийн инженер'],
    ],
  },
  TSBU: {
    senior: [['Билгүүн', 'Сугар', 'BLG', 'senior', 'ЦБУ-ын ахлах инженер']],
    rest: [['Жавзанжамъяан', 'Бямба', 'JJN', 'engineer', 'ЦБУ-ын инженер']],
  },
  TSAH: {
    senior: [['Нэмэхбаяр', 'Эрдэнэсүрэн', 'NBE', 'senior', 'Цахилгааны ахлах инженер']],
    rest: [
      ['Анударь', 'Ууганбаатар', 'ARI', 'engineer', 'Цахилгааны инженер'],
      ['Баасанжав', 'Нямбазар', 'BSJ', 'engineer', 'Цахилгааны инженер'],
      ['Булган', 'Ганзориг', 'BGN', 'engineer', 'Цахилгааны инженер'],
      ['Мянганзул', 'Пүрэвбаатар', 'MGZ', 'engineer', 'Цахилгааны инженер'],
      ['Отгонцацрал', 'Оюунбилэг', 'OTS', 'engineer', 'Цахилгааны инженер'],
    ],
  },
  HD: {
    senior: [],
    rest: [['Мөнхсайхан', 'Түмэнжаргал', 'MCT', 'engineer', 'Холбоо дохиоллын инженер']],
  },
  AU: {
    senior: [],
    rest: [['Санжаасүрэн', 'Энх-Амгалан', 'SNJ', 'engineer', 'Автомат удирдлагын инженер']],
  },
  IZ: {
    senior: [['Сандагдорж', 'Батсүх', 'TMS', 'senior', 'Интерьерын ахлах дизайнер']],
    rest: [
      ['Ариунжаргал', 'Жамъянгарав', 'BAB', 'architect', 'Интерьер дизайнер'],
      ['Andrea', 'Tuzau', 'AND', 'architect', 'Интерьер дизайнер'],
      ['Марал', 'Наадамбаяр', 'MRL', 'architect', 'Интерьер дизайнер'],
      ['Өлзийжаргал', 'Адьяа', 'UZI', 'architect', 'Интерьер дизайнер'],
      ['Энхтуяа', 'Дамдинсүрэн', 'TUY', 'architect', 'Интерьер дизайнер'],
    ],
  },
  MGMT: {
    senior: [
      // Төслийн менежер need admin powers: approve progress, see team view.
      ['Наранзул', 'Цэцгээ', 'NRN', 'senior', 'Төслийн менежер'],
      ['Энхмаа', 'Бат-Өлзий', 'ENM', 'senior', 'Төслийн менежер'],
    ],
    rest: [
      ['Лхагва-Ундрал', 'Лхагвасүрэн', 'LKH', 'architect', 'График дизайнер'],
      ['Оюунтөгс', 'Батжаргал', 'OYK', 'architect', 'График дизайнер'],
      ['Анужин', 'Төмөрсүх', 'ANJ', 'client', 'Хуульч'],
      ['Золбоо', 'Энхтөр', 'ZLB', 'client', 'Нягтлан бодогч'],
    ],
  },
};

// Username = lowercase employee_id (short + stable + unique per employee)
// Full name = "Last First" (Монгол ёсоор: овог нэр).
const rows = [];
for (const [teamCode, group] of Object.entries(data)) {
  for (const emp of [...group.senior, ...group.rest]) {
    const [first, last, empId, role, position] = emp;
    const username = empId.toLowerCase();
    const fullName = `${last} ${first}`.replace(/\s+/g, ' ').trim();
    rows.push({ username, fullName, role, empId, position, teamCode });
  }
}

const sqlEscape = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const out = [];
out.push('-- =============================================');
out.push('-- Seed company employees into users + teams');
out.push('-- =============================================');
out.push('-- Auto-generated by scripts/gen-seed-employees.mjs');
out.push(`-- Default password for all seeded users: ${DEFAULT_PASSWORD}`);
out.push('-- Each INSERT is guarded by the employee_id uniqueness so this');
out.push('-- migration is safe to re-run.');
out.push('');

for (const r of rows) {
  out.push(
    `INSERT OR IGNORE INTO users (username, password_hash, full_name, role, status, employee_id, position, team_id)
SELECT ${sqlEscape(r.username)}, ${sqlEscape(hash)}, ${sqlEscape(r.fullName)}, ${sqlEscape(r.role)}, 'active', ${sqlEscape(r.empId)}, ${sqlEscape(r.position)}, t.id
FROM teams t
WHERE t.code = ${sqlEscape(r.teamCode)}
  AND NOT EXISTS (SELECT 1 FROM users WHERE employee_id = ${sqlEscape(r.empId)});`,
  );
  out.push('');
}

const outPath = join(__dirname, '..', 'migrations', '0008_seed_employees.sql');
writeFileSync(outPath, out.join('\n'), 'utf8');
console.log(`Wrote ${rows.length} employees to ${outPath}`);
console.log(`Default password: ${DEFAULT_PASSWORD}`);
