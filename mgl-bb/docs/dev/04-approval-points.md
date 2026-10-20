# §04 · Approval & оноо

Ажилтан progress илгээхэд `progress_entries`-д `status='pending'`-оор бууна. Батлах queue нь `/api/progress` → `ApprovalsPage`.

## Батлагч хэн бэ

- admin-tier хэрэглэгчид, **эсвэл**
- тухайн багийн `lead_user_id` (заавал `senior` role, тухайн багийн одоогийн гишүүн байх ёстой — lead тавихад enforce хийдэг).

## Оноо

Батлахад `user_points` бичигдэнэ:

```
COMPLEXITY_PERCENT[project.complexity] × deltaPct/100
```

тэнцүү хуваагдаж eligible assignee-үүдэд. **admin / management / client оноо авдаггүй** (`isLeaderboardEligible`).

## Нэг нарийн зүйл — notify нь gate-ээс явцуу

«Батлах хүлээж байна» мэдэгдэл (`createNotificationForReviewers` — `lib/notify.ts`) нь batlagch gate-ээс **санаатай** явцуу:

- Зөвхөн тухайн багийн `lead_user_id` руу ping,
- lead байхгүй бол багийн `senior` гишүүд рүү,
- тэр ч байхгүй (баг/senior алга) бол л admin-tier руу.

~7 admin-той болохоор бүх багийн батлалтыг бүгд рүү цацвал хүн бүрийн queue булингартана. Бусад admin `ApprovalsPage`-аас батлах боломжтой хэвээр, зүгээр ping авахгүй.
