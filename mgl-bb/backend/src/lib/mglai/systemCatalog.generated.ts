/**
 * ⚠️ ҮҮСГЭСЭН ФАЙЛ — ГАРААР ЗАСАХГҮЙ.
 *    `node scripts/gen-system-catalog.mjs` (backend/) дахин ажиллуулна.
 *    Эх сурвалж: frontend Layout.tsx NAV_ITEMS + search/sections.ts + i18n.
 *    `systemCatalog.test.ts` нь `--check`-ээр зөрүүг барина.
 */
export interface SystemPageSection {
  to: string;
  labelMn: string;
  labelEn: string;
  keywords: string;
  roles: readonly string[] | null;
}
export interface SystemPageChild {
  to: string;
  labelMn: string;
  labelEn: string;
  roles: readonly string[] | null;
}
export interface SystemPage {
  path: string;
  labelMn: string;
  labelEn: string;
  group: string | null;
  /** Цэсэнд ХАРАГДАХ роль — `Layout.tsx`-ийн ЯГ жагсаалт. */
  roles: readonly string[];
  children: readonly SystemPageChild[];
  sections: readonly SystemPageSection[];
}

export const SYSTEM_PAGES: readonly SystemPage[] = [
  {
    "path": "/app",
    "labelMn": "Хянах самбар",
    "labelEn": "Dashboard",
    "group": "overview",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app?section=sec-dashboard-score",
        "labelMn": "Миний бүтээмж",
        "labelEn": "My productivity",
        "keywords": "миний бүтээмж оноо өдрийн productivity score",
        "roles": null
      },
      {
        "to": "/app?section=sec-dashboard-tasks",
        "labelMn": "Миний даалгаврууд",
        "labelEn": "My tasks",
        "keywords": "миний даалгавар ажил my tasks",
        "roles": null
      },
      {
        "to": "/app?section=sec-dashboard-projects",
        "labelMn": "Идэвхтэй төслүүд",
        "labelEn": "Active projects",
        "keywords": "идэвхтэй төсөл active projects",
        "roles": null
      },
      {
        "to": "/app?section=sec-dashboard-attendance",
        "labelMn": "Ирц",
        "labelEn": "Attendance",
        "keywords": "ирц бүртгүүлэх clock widget",
        "roles": null
      },
      {
        "to": "/app?section=sec-dashboard-deadlines",
        "labelMn": "Ойрын эцсийн хугацаанууд",
        "labelEn": "Upcoming deadlines",
        "keywords": "ойрын эцсийн хугацаа upcoming deadline",
        "roles": null
      },
      {
        "to": "/app?section=sec-dashboard-calendar",
        "labelMn": "Хуанли",
        "labelEn": "Calendar",
        "keywords": "хуанли календар google calendar уулзалт",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/company",
    "labelMn": "Компани",
    "labelEn": "Company",
    "group": "overview",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/company?section=sec-company-projects",
        "labelMn": "Төслийн жагсаалт",
        "labelEn": "Project list",
        "keywords": "төслийн жагсаалт бүх төсөл project list",
        "roles": null
      },
      {
        "to": "/app/company?section=sec-company-attendance",
        "labelMn": "Өнөөдрийн ирц",
        "labelEn": "Today's attendance",
        "keywords": "өнөөдрийн ирц компани attendance today",
        "roles": null
      },
      {
        "to": "/app/company?section=sec-company-active",
        "labelMn": "Өнөөдрийн идэвхтэй төслүүд",
        "labelEn": "Today's active projects",
        "keywords": "өнөөдөр идэвхтэй төсөл active today",
        "roles": null
      },
      {
        "to": "/app/company?section=sec-company-activity",
        "labelMn": "30 хоногийн идэвхжил",
        "labelEn": "30-day activity",
        "keywords": "30 хоног идэвхжил график activity trend",
        "roles": null
      },
      {
        "to": "/app/company?section=sec-company-overdue",
        "labelMn": "Хугацаа хэтэрсэн",
        "labelEn": "Overdue",
        "keywords": "хугацаа хэтэрсэн overdue",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/announcements",
    "labelMn": "Нийтийн мэдээлэл",
    "labelEn": "Announcements",
    "group": "overview",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [
      {
        "to": "/app/rules",
        "labelMn": "Дотоод журам",
        "labelEn": "Internal rules",
        "roles": null
      },
      {
        "to": "/app/admin/announcements",
        "labelMn": "Удирдлага",
        "labelEn": "Management",
        "roles": [
          "admin"
        ]
      }
    ],
    "sections": [
      {
        "to": "/app/announcements?tab=system_update",
        "labelMn": "Системийн шинэчлэлт",
        "labelEn": "System update",
        "keywords": "системийн шинэчлэлт system update шинэ боломж хувилбар release",
        "roles": null
      },
      {
        "to": "/app/announcements?tab=company_info",
        "labelMn": "Компанийн мэдээлэл",
        "labelEn": "Company information",
        "keywords": "компанийн мэдээлэл company info мэдээ news",
        "roles": null
      },
      {
        "to": "/app/announcements?tab=announcement",
        "labelMn": "Зарлал",
        "labelEn": "Announcement",
        "keywords": "зарлал announcement notice чухал дотоод",
        "roles": null
      },
      {
        "to": "/app/admin/announcements?tab=rules",
        "labelMn": "Дотоод журам удирдах",
        "labelEn": "Manage internal rules",
        "keywords": "дотоод журам удирдах нийтлэх шинэ журам хувилбар гарын үсэг хэн зурсан internal rules manage publish version signatures dotood juram",
        "roles": [
          "admin"
        ]
      }
    ]
  },
  {
    "path": "/app/timeline",
    "labelMn": "Хуваарь",
    "labelEn": "Timeline",
    "group": "overview",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/timeline?section=sec-timeline-gantt",
        "labelMn": "Төслийн эцсийн хугацаа",
        "labelEn": "Project deadlines",
        "keywords": "эцсийн хугацаа deadline milestone шалгах цэг",
        "roles": null
      },
      {
        "to": "/app/timeline?section=sec-timeline-toolbar",
        "labelMn": "Төлөв",
        "labelEn": "State",
        "keywords": "шүүлт төлөв эрсдэл хэтэрсэн filter",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/my-tasks",
    "labelMn": "Миний ажлууд",
    "labelEn": "My Tasks",
    "group": "overview",
    "roles": [
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/my-tasks?section=sec-mytasks-repair",
        "labelMn": "Миний засвар",
        "labelEn": "My repairs",
        "keywords": "миний засвар цаг repair",
        "roles": null
      },
      {
        "to": "/app/my-tasks?section=sec-mytasks-non-project",
        "labelMn": "Төслийн бус ажил",
        "labelEn": "Non-project work",
        "keywords": "төслийн бус ажил цаас наах баримт бичиг янзлах зохиогчийн хяналт non-project",
        "roles": [
          "engineer",
          "architect",
          "senior"
        ]
      },
      {
        "to": "/app/my-tasks?section=sec-mytasks-previous",
        "labelMn": "Өмнөх тайлан",
        "labelEn": "Previous reports",
        "keywords": "өчигдөр өмнөх тайлан түүх previous yesterday history",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/projects",
    "labelMn": "Төслүүд",
    "labelEn": "Projects",
    "group": "work",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/projects?section=sec-project-readiness",
        "labelMn": "Төслийн хяналтын бэлэн байдал",
        "labelEn": "Project review readiness",
        "keywords": "бэлэн байдал хянахад бэлэн readiness review gate хаалга belen",
        "roles": null
      },
      {
        "to": "/app/projects?section=sec-project-gaps",
        "labelMn": "Цоорхой",
        "labelEn": "Gaps",
        "keywords": "цоорхой дутуу бүрэн бус gap completeness missing tsoorhoi",
        "roles": null
      },
      {
        "to": "/app/projects?section=sec-project-quality",
        "labelMn": "Дүрмийн чанар",
        "labelEn": "Rule quality",
        "keywords": "дүрмийн чанар худал дохио false positive fp fn quality durmiin chanar",
        "roles": [
          "admin",
          "senior"
        ]
      },
      {
        "to": "/app/projects?section=sec-derived-projects",
        "labelMn": "Үүсмэл төслүүд",
        "labelEn": "Derived projects",
        "keywords": "үүссэн төсөл эх төсөл засвар бүтэц татах хуулбар derived source project copy structure uussen tosol eh tosol",
        "roles": [
          "admin",
          "senior"
        ]
      }
    ]
  },
  {
    "path": "/app/documents",
    "labelMn": "Төслийн баримт бичиг",
    "labelEn": "Project documents",
    "group": "work",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/asr",
    "labelMn": "Зохиогчийн хяналт",
    "labelEn": "Author supervision",
    "group": "work",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/asr?section=sec-asr-plans",
        "labelMn": "Хяналтын хуваарь",
        "labelEn": "Supervision schedule",
        "keywords": "хяналтын хуваарь төлөвлөгөө талбайд явах asr visit plan schedule",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-projects",
        "labelMn": "Төслүүд",
        "labelEn": "Projects",
        "keywords": "зохиогчийн хяналт төслүүд asr projects",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-kpi",
        "labelMn": "Нийт очилт",
        "labelEn": "Total visits",
        "keywords": "зохиогчийн хяналт очилт статистик тоо asr visits stats",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-safety",
        "labelMn": "Талбайд гарахын өмнө",
        "labelEn": "Before going to site",
        "keywords": "аюулгүй байдал хабэа каск хантааз хамгаалалтын хувцас талбай safety ppe site",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-monthly",
        "labelMn": "Сарын очилт",
        "labelEn": "Monthly visits",
        "keywords": "сарын очилт график asr monthly chart",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-completeness",
        "labelMn": "Бүрдэл",
        "labelEn": "Completeness",
        "keywords": "улаан дэвтэр гарын үсэг батлах хугацаа бүрдэл red book signatures review time",
        "roles": null
      },
      {
        "to": "/app/asr?section=sec-asr-recent",
        "labelMn": "Сүүлийн тайлангууд",
        "labelEn": "Recent reports",
        "keywords": "сүүлийн зохиогчийн хяналтын тайлан recent asr reports",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/attendance",
    "labelMn": "Ирц",
    "labelEn": "Attendance",
    "group": "people",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "worker"
    ],
    "children": [
      {
        "to": "/app/attendance/admin",
        "labelMn": "Ирцийн самбар",
        "labelEn": "Attendance board",
        "roles": [
          "admin"
        ]
      }
    ],
    "sections": [
      {
        "to": "/app/attendance?section=sec-attendance-overtime",
        "labelMn": "Илүү цаг",
        "labelEn": "Overtime",
        "keywords": "илүү цаг илүүцаг нэмэлт цаг overtime ot иллүү",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-leaves",
        "labelMn": "Миний чөлөөний хүсэлтүүд",
        "labelEn": "My leave requests",
        "keywords": "чөлөө амралт хүсэлт leave vacation чөлөөний хүсэлт",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-ooo",
        "labelMn": "Ажлаас гадуурх цаг",
        "labelEn": "Out-of-office time",
        "keywords": "гадуур ажлаас гадуурх томилолт out of office ooo",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-notice",
        "labelMn": "Ирцийн журмын анхааруулга",
        "labelEn": "Attendance policy notice",
        "keywords": "журам анхааруулга гарах бүртгэл заавал notice policy clock out rule",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-today",
        "labelMn": "Өнөөдрийн ирц",
        "labelEn": "Today's attendance",
        "keywords": "ирлээ явлаа бүртгүүлэх clock in out өнөөдөр",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-schedule",
        "labelMn": "Миний ажлын цагийн хуваарь",
        "labelEn": "My work schedule",
        "keywords": "цагийн хуваарь ээлж schedule shift 08 09",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-weekly",
        "labelMn": "Долоо хоногийн цаг",
        "labelEn": "Weekly hours",
        "keywords": "долоо хоног график weekly hours chart",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-recent",
        "labelMn": "Сүүлийн бүртгэлүүд",
        "labelEn": "Recent sessions",
        "keywords": "сүүлийн бүртгэл түүх history sessions",
        "roles": null
      },
      {
        "to": "/app/attendance?section=sec-attendance-monthly",
        "labelMn": "Миний сарын ирц",
        "labelEn": "My monthly attendance",
        "keywords": "сарын ирц хуанли monthly calendar",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=today",
        "labelMn": "Өнөөдөр",
        "labelEn": "Today",
        "keywords": "өнөөдөр ирсэн ирээгүй хоцорсон today present absent",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=open",
        "labelMn": "Хаагдаагүй",
        "labelEn": "Unclosed",
        "keywords": "хаагдаагүй нээлттэй бүртгэл open sessions",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=reports",
        "labelMn": "Тайлан",
        "labelEn": "Reports",
        "keywords": "ирцийн тайлан report",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=today&section=sec-att-admin-present",
        "labelMn": "Өнөөдөр ирсэн ({count})",
        "labelEn": "Present today ({count})",
        "keywords": "ирсэн хүмүүс өнөөдөр present",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=today&section=sec-att-admin-absent",
        "labelMn": "Ирээгүй ({count})",
        "labelEn": "Absent ({count})",
        "keywords": "ирээгүй тасалсан absent",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=reports&section=sec-att-admin-timesheet",
        "labelMn": "Цагийн хүснэгт",
        "labelEn": "Timesheet",
        "keywords": "цагийн хүснэгт timesheet",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=reports&section=sec-att-admin-daily",
        "labelMn": "Өдрийн мэдээ",
        "labelEn": "Daily breakdown",
        "keywords": "өдрийн мэдээ daily breakdown",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=summary",
        "labelMn": "Хураангуй",
        "labelEn": "Summary",
        "keywords": "хураангуй нэгдсэн summary",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=summary&section=sec-att-admin-summary",
        "labelMn": "Хураангуй тайлан",
        "labelEn": "Summary report",
        "keywords": "хураангуй тайлан нэгдсэн summary report",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=leaves",
        "labelMn": "Чөлөө",
        "labelEn": "Leave",
        "keywords": "чөлөө батлах ээлжийн амралт leave approve annual",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=outofoffice",
        "labelMn": "Гадуурх цаг",
        "labelEn": "Out of office",
        "keywords": "гадуурх цаг томилолт out of office",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=shifts",
        "labelMn": "Ажлын цаг",
        "labelEn": "Work hours",
        "keywords": "ажлын цаг ээлж хуваарь сонголт 8-17 8:30-17:30 9-18 shift schedule work hours roster",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=shifts&section=sec-att-admin-shifts",
        "labelMn": "Ажилтны ажлын цагийн сонголт",
        "labelEn": "Employee shift choices",
        "keywords": "хэн хэдэн цагаас ажилладаг ээлжийн жагсаалт who works when shift list",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=ips",
        "labelMn": "IP хаяг",
        "labelEn": "IP address",
        "keywords": "ip хаяг оффис сүлжээ office network wifi",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=ips&section=sec-att-admin-late",
        "labelMn": "Хоцролтын тохиргоо",
        "labelEn": "Late settings",
        "keywords": "хоцролт торгууль тохиргоо late penalty grace",
        "roles": null
      },
      {
        "to": "/app/attendance/admin?tab=ips&section=sec-att-admin-ips",
        "labelMn": "Оффисын IP хаягууд",
        "labelEn": "Office IP addresses",
        "keywords": "оффисын ip хаяг цагаан жагсаалт allowlist",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/reports",
    "labelMn": "Тайлан",
    "labelEn": "Reports",
    "group": "people",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/reports?tab=overview",
        "labelMn": "Ажилтнууд",
        "labelEn": "Employees",
        "keywords": "тайлан ажилтнууд бүтээмж байр хандлага employees report rank trend",
        "roles": null
      },
      {
        "to": "/app/reports?tab=employee",
        "labelMn": "Ажилтан",
        "labelEn": "Employee",
        "keywords": "ажилтны тайлан гэрээ нууц үг hr employee report contract password",
        "roles": null
      },
      {
        "to": "/app/reports?tab=teams",
        "labelMn": "Багууд",
        "labelEn": "Teams",
        "keywords": "багийн тайлан team report",
        "roles": null
      },
      {
        "to": "/app/reports?tab=snapshots",
        "labelMn": "Өдрийн тайлан",
        "labelEn": "Daily reports",
        "keywords": "өдрийн тайлан snapshot backfill daily report",
        "roles": null
      },
      {
        "to": "/app/reports?tab=repair",
        "labelMn": "Засварын төслийн тайлан",
        "labelEn": "Repair project reports",
        "keywords": "засварын төсөл тайлан дотоод ажил хувь цаг repair project report internal work",
        "roles": null
      },
      {
        "to": "/app/reports?tab=nonproject",
        "labelMn": "Төслийн бус ажлын тайлан",
        "labelEn": "Non-project work reports",
        "keywords": "төслийн бус ажил батлах шалгах баталгаажуулах non-project work approve review verification",
        "roles": null
      },
      {
        "to": "/app/reports?tab=tasktime",
        "labelMn": "Таскийн цаг",
        "labelEn": "Task time",
        "keywords": "таскийн цаг албан ёсны таймер эхлүүлэх зогсоох хэн ажиллаж байна ажилласан цаг task time official timer working now hours",
        "roles": null
      },
      {
        "to": "/app/reports?tab=mgmt",
        "labelMn": "Менежментийн багийн тайлан",
        "labelEn": "Management team",
        "keywords": "менежментийн баг өдрийн ажлын тайлан нэгтгэл хэн юу хийсэн management team daily work log digest",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/teams",
    "labelMn": "Багууд",
    "labelEn": "Teams",
    "group": "people",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/teams?tab=overview&section=sec-teams-overview",
        "labelMn": "Тойм",
        "labelEn": "Overview",
        "keywords": "тойм график донат диаграм баг төсөл хүн ирц overview chart donut team project people",
        "roles": [
          "admin",
          "senior"
        ]
      },
      {
        "to": "/app/teams?tab=byTeam&section=sec-teams-by-team",
        "labelMn": "Багаар",
        "labelEn": "By team",
        "keywords": "баг ачаалал гишүүн team load member workload",
        "roles": [
          "admin",
          "senior"
        ]
      }
    ]
  },
  {
    "path": "/app/users",
    "labelMn": "Хэрэглэгчид",
    "labelEn": "Users",
    "group": "people",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/users?tab=staff",
        "labelMn": "Ажилтнууд",
        "labelEn": "Staff",
        "keywords": "ажилтан хүн жагсаалт staff employees",
        "roles": null
      },
      {
        "to": "/app/users?tab=pgp",
        "labelMn": "Хөгжлийн төлөвлөгөө",
        "labelEn": "Growth plans",
        "keywords": "хөгжлийн төлөвлөгөө pgp growth plan",
        "roles": null
      },
      {
        "to": "/app/users?tab=assessments",
        "labelMn": "Ур чадварын үнэлгээ",
        "labelEn": "Skills assessment",
        "keywords": "үнэлгээ ур чадвар судалгаа assessment skill survey",
        "roles": null
      },
      {
        "to": "/app/users?tab=assessments&assessTab=rounds",
        "labelMn": "Ээлжүүд",
        "labelEn": "Rounds",
        "keywords": "ээлж судалгаа round",
        "roles": null
      },
      {
        "to": "/app/users?tab=assessments&assessTab=templates",
        "labelMn": "Загварууд",
        "labelEn": "Templates",
        "keywords": "загвар асуулга template questionnaire",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/mail",
    "labelMn": "Захидал",
    "labelEn": "Mail",
    "group": "business",
    "roles": [
      "admin"
    ],
    "children": [
      {
        "to": "/app/admin/email",
        "labelMn": "И-мэйл хайрцгууд",
        "labelEn": "Email accounts",
        "roles": null
      }
    ],
    "sections": [
      {
        "to": "/app/mail?folder=untriaged",
        "labelMn": "Ангилаагүй",
        "labelEn": "Untriaged",
        "keywords": "ангилаагүй триаж untriaged",
        "roles": null
      },
      {
        "to": "/app/mail?folder=inbox",
        "labelMn": "Ирсэн",
        "labelEn": "Inbox",
        "keywords": "ирсэн захидал inbox",
        "roles": null
      },
      {
        "to": "/app/mail?folder=sent",
        "labelMn": "Явсан",
        "labelEn": "Sent",
        "keywords": "явсан илгээсэн sent",
        "roles": null
      },
      {
        "to": "/app/mail?folder=all",
        "labelMn": "Бүх захидал",
        "labelEn": "All mail",
        "keywords": "бүх захидал all mail",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/meeting-notes",
    "labelMn": "Хурлын тэмдэглэл",
    "labelEn": "Meeting Notes",
    "group": "business",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/qto",
    "labelMn": "Тоо хэмжээ",
    "labelEn": "Quantities",
    "group": "work",
    "roles": [
      "admin",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/qto?tab=dashboard",
        "labelMn": "Самбар",
        "labelEn": "Dashboard",
        "keywords": "самбар тоо хэмжээ dashboard boq",
        "roles": null
      },
      {
        "to": "/app/qto?tab=overview",
        "labelMn": "Тойм",
        "labelEn": "Overview",
        "keywords": "тойм нийт дүн overview totals",
        "roles": null
      },
      {
        "to": "/app/qto?tab=pivot",
        "labelMn": "Ангилал",
        "labelEn": "Breakdown",
        "keywords": "ангилал материал шифр pivot classification",
        "roles": null
      },
      {
        "to": "/app/qto?tab=history",
        "labelMn": "Түүх",
        "labelEn": "History",
        "keywords": "түүх илгээлт run history",
        "roles": null
      },
      {
        "to": "/app/qto?tab=overview&section=sec-qto-latest",
        "labelMn": "Сүүлийн илгээлт",
        "labelEn": "Latest run",
        "keywords": "сүүлийн илгээлт latest run revit",
        "roles": null
      },
      {
        "to": "/app/qto?tab=overview&section=sec-qto-category",
        "labelMn": "Категориор",
        "labelEn": "By category",
        "keywords": "категори ангилалаар by category",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/quotes",
    "labelMn": "Үнийн санал",
    "labelEn": "Price quotes",
    "group": "business",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/quotes?tab=list",
        "labelMn": "Саналын жагсаалт",
        "labelEn": "All quotes",
        "keywords": "саналын жагсаалт quote list",
        "roles": null
      },
      {
        "to": "/app/quotes?tab=templates",
        "labelMn": "Загварууд",
        "labelEn": "Templates",
        "keywords": "загвар хяналтын төсөв template",
        "roles": null
      },
      {
        "to": "/app/quotes?tab=tariffs",
        "labelMn": "Тарифын каталог",
        "labelEn": "Tariff catalogue",
        "keywords": "тариф каталог бд 81-16-20 tariff catalog",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/revit-addin",
    "labelMn": "Revit нэмэлт",
    "labelEn": "Revit Add-in",
    "group": "utility",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/mgl-ai",
    "labelMn": "MGL AI",
    "labelEn": "MGL AI",
    "group": "utility",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/admin/mgl-ai-feedback",
    "labelMn": "MGL AI · санал хүсэлт",
    "labelEn": "MGL AI feedback",
    "group": "utility",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/admin/mgl-ai-fleet",
    "labelMn": "MGL AI · суулгац ба релиз",
    "labelEn": "MGL AI fleet & releases",
    "group": "utility",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/admin/system-workbench",
    "labelMn": "Системийн самбар",
    "labelEn": "System workbench",
    "group": "utility",
    "roles": [
      "admin"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/admin/task-allocation",
    "labelMn": "Таскийн хуваарилалт",
    "labelEn": "Task allocation",
    "group": "utility",
    "roles": [
      "admin",
      "senior"
    ],
    "children": [],
    "sections": []
  },
  {
    "path": "/app/admin/assistant",
    "labelMn": "Туслахын сургалт",
    "labelEn": "Assistant training",
    "group": "utility",
    "roles": [
      "admin",
      "senior"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/admin/assistant?tab=pending",
        "labelMn": "Хүлээгдэж буй",
        "labelEn": "Pending",
        "keywords": "хүлээгдэж буй шошголоогүй pending queue label curate туслах",
        "roles": null
      },
      {
        "to": "/app/admin/assistant?tab=reviewed",
        "labelMn": "Хянасан",
        "labelEn": "Reviewed",
        "keywords": "хянасан татгалзсан rejected reviewed history туслах",
        "roles": null
      },
      {
        "to": "/app/admin/assistant?tab=examples",
        "labelMn": "Сургалтын багц",
        "labelEn": "Training set",
        "keywords": "сургалтын багц жишээ example corpus training set",
        "roles": null
      },
      {
        "to": "/app/admin/assistant?tab=overrides",
        "labelMn": "Хүчингүй болголт",
        "labelEn": "Overrides",
        "keywords": "хүчингүй болголт зөрчил татгалзал override false positive норм дүгнэлт",
        "roles": null
      }
    ]
  },
  {
    "path": "/app/settings",
    "labelMn": "Тохиргоо",
    "labelEn": "Settings",
    "group": "utility",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ],
    "children": [],
    "sections": [
      {
        "to": "/app/settings?section=settings-account",
        "labelMn": "Хэрэглэгч",
        "labelEn": "Account",
        "keywords": "хэрэглэгчийн мэдээлэл бүртгэл account",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-appearance",
        "labelMn": "Гадаад төрх",
        "labelEn": "Appearance",
        "keywords": "гадаад төрх өнгө сэдэв бараан цайвар дундаж theme dark light dim хэл",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-notifications",
        "labelMn": "Мэдэгдэл",
        "labelEn": "Notifications",
        "keywords": "мэдэгдэл push notification сануулга",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-branding",
        "labelMn": "Лого",
        "labelEn": "Logo",
        "keywords": "лого брэнд тайлангийн logo branding",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-holidays",
        "labelMn": "Баярын өдрүүд",
        "labelEn": "Holidays",
        "keywords": "баярын өдөр ажлын бус амралтын holiday",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-security",
        "labelMn": "Аюулгүй байдал",
        "labelEn": "Security",
        "keywords": "аюулгүй байдал нууц үг security password",
        "roles": null
      },
      {
        "to": "/app/settings?section=settings-ticker",
        "labelMn": "Гүйдэг мэдээ",
        "labelEn": "Header ticker",
        "keywords": "гүйдэг мэдээ зурвас толгой урсдаг зар мэдээлэл ticker marquee news banner announcement",
        "roles": [
          "admin"
        ]
      },
      {
        "to": "/app/approvals?view=repair",
        "labelMn": "Засвар",
        "labelEn": "Repairs",
        "keywords": "засвар дахин ажил repair rework",
        "roles": null
      }
    ]
  }
] as const;

/** Цэсэнд ороогүй ч бүртгэлтэй хэсгүүд (профайл гэх мэт). */
export const SYSTEM_ORPHAN_SECTIONS: readonly SystemPageSection[] = [
  {
    "to": "/app/profile?tab=profile",
    "labelMn": "Хувийн мэдээлэл",
    "labelEn": "Personal info",
    "keywords": "хувийн мэдээлэл нэр утас profile personal",
    "roles": null
  },
  {
    "to": "/app/profile?tab=security",
    "labelMn": "Нууц үг",
    "labelEn": "Password",
    "keywords": "нууц үг солих password change нэвтрэх",
    "roles": null
  },
  {
    "to": "/app/profile?tab=activity",
    "labelMn": "Явцын түүх",
    "labelEn": "Progress history",
    "keywords": "явцын түүх илгээсэн activity history",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ]
  },
  {
    "to": "/app/profile?tab=score",
    "labelMn": "Бүтээмж",
    "labelEn": "Productivity",
    "keywords": "бүтээмж оноо миний score points",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ]
  },
  {
    "to": "/app/profile?tab=assessment",
    "labelMn": "Ур чадварын тодорхойлолт",
    "labelEn": "Skill definitions",
    "keywords": "ур чадвар үнэлгээ судалгаа түвшин assessment skill level",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior"
    ]
  },
  {
    "to": "/app/profile?tab=pgp",
    "labelMn": "Төлөвлөгөө",
    "labelEn": "Growth plan",
    "keywords": "хөгжлийн төлөвлөгөө pgp growth plan",
    "roles": [
      "admin",
      "engineer",
      "architect",
      "senior",
      "client"
    ]
  },
  {
    "to": "/app/profile?tab=worklog",
    "labelMn": "Өдрийн тайлан",
    "labelEn": "Daily report",
    "keywords": "өдрийн тайлан хийсэн ажил тэмдэглэл daily report work log journal",
    "roles": [
      "admin"
    ]
  },
  {
    "to": "/app/leaderboard?tab=list",
    "labelMn": "Жагсаалт",
    "labelEn": "List",
    "keywords": "чансаа жагсаалт оноо leaderboard list",
    "roles": null
  },
  {
    "to": "/app/leaderboard?tab=monthly",
    "labelMn": "Сарын тайлан",
    "labelEn": "Monthly report",
    "keywords": "сарын тайлан monthly report",
    "roles": null
  },
  {
    "to": "/app/leaderboard?tab=trend",
    "labelMn": "Хандлага",
    "labelEn": "Trend",
    "keywords": "хандлага график trend chart",
    "roles": null
  },
  {
    "to": "/app/leaderboard?tab=list&section=sec-leaderboard-top",
    "labelMn": "Тэргүүлэгч",
    "labelEn": "Top performer",
    "keywords": "тэргүүлэгч шилдэг top performer",
    "roles": null
  },
  {
    "to": "/app/leaderboard?tab=list&section=sec-leaderboard-active",
    "labelMn": "Идэвхтэй гишүүд",
    "labelEn": "Active members",
    "keywords": "идэвхтэй гишүүн active members",
    "roles": null
  },
  {
    "to": "/app/leaderboard?tab=list&section=sec-leaderboard-team-avg",
    "labelMn": "Багийн дундаж",
    "labelEn": "Team average",
    "keywords": "багийн дундаж team average",
    "roles": null
  }
] as const;
