/**
 * Ирцийн roster — «ирэх ёстой» ажилтны жагсаалтын ганц эх сурвалж.
 *
 * assessmentRoster.ts-тай ижил зарчим: roster SQL-ийг олон файлд хуулбарлахгүй,
 * энд нэг удаа тодорхойлно.  TV (`is_support=1`), тест/тусгай данс, client,
 * идэвхгүй, CEO roster-оос хасагдана.
 */
import { excludeCeoSql } from './ceo';

/** SQL WHERE clause fragments (WHERE keyword-гүй). */
export function attendanceRosterSql(alias = 'u'): string {
  return [
    `${alias}.status = 'active'`,
    `${alias}.role != 'client'`,
    `${alias}.is_support = 0`,
    excludeCeoSql(alias),
  ].join(' AND ');
}
