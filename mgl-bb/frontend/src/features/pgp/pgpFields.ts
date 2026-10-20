/**
 * PGP (Хувь хүний хөгжлийн төлөвлөгөө) маягтын талбарын схем.
 *
 * Бүх талбар backend-ийн `answers_json` (Record<string,string>)-д хадгалагдана —
 * энэ схем зөвхөн frontend талд байх тул маягт өөрчлөгдөхөд migration хэрэггүй
 * (quotes.data_json хэв маяг). Талбар/section-ийг эндээс нэмж хасна.
 */

export interface PgpFieldOption {
  value: string;
  labelKey: string;
}

export interface PgpField {
  /** answers object дахь түлхүүр (backend-тэй тохирно). */
  key: string;
  /** i18n label түлхүүр. */
  labelKey: string;
  /** i18n placeholder түлхүүр (textarea-д). */
  placeholderKey?: string;
  type: 'textarea' | 'select';
  rows?: number;
  /** type='select' үед сонголтууд. */
  options?: PgpFieldOption[];
}

export interface PgpSection {
  titleKey: string;
  fields: PgpField[];
}

export const PGP_SECTIONS: PgpSection[] = [
  {
    titleKey: 'pgp.sectionSelf',
    fields: [
      {
        key: 'strengths',
        labelKey: 'pgp.strengths',
        placeholderKey: 'pgp.strengthsPlaceholder',
        type: 'textarea',
        rows: 3,
      },
      {
        key: 'challenges',
        labelKey: 'pgp.challenges',
        placeholderKey: 'pgp.challengesPlaceholder',
        type: 'textarea',
        rows: 3,
      },
    ],
  },
  {
    titleKey: 'pgp.sectionGrowth',
    fields: [
      {
        key: 'project_involvement',
        labelKey: 'pgp.projectInvolvement',
        placeholderKey: 'pgp.projectInvolvementPlaceholder',
        type: 'textarea',
        rows: 2,
      },
      {
        key: 'technical_skills',
        labelKey: 'pgp.technicalSkills',
        placeholderKey: 'pgp.technicalSkillsPlaceholder',
        type: 'textarea',
        rows: 2,
      },
      {
        key: 'career_direction',
        labelKey: 'pgp.careerDirection',
        type: 'select',
        options: [
          { value: '', labelKey: 'pgp.careerUndecided' },
          { value: 'specialist', labelKey: 'pgp.careerSpecialist' },
          { value: 'management', labelKey: 'pgp.careerManagement' },
        ],
      },
    ],
  },
  {
    titleKey: 'pgp.sectionCross',
    fields: [
      {
        key: 'cross_discipline',
        labelKey: 'pgp.crossDiscipline',
        placeholderKey: 'pgp.crossDisciplinePlaceholder',
        type: 'textarea',
        rows: 2,
      },
    ],
  },
  {
    titleKey: 'pgp.sectionOrg',
    fields: [
      {
        key: 'org_support',
        labelKey: 'pgp.orgSupport',
        placeholderKey: 'pgp.orgSupportPlaceholder',
        type: 'textarea',
        rows: 2,
      },
      {
        key: 'work_environment',
        labelKey: 'pgp.workEnvironment',
        placeholderKey: 'pgp.workEnvironmentPlaceholder',
        type: 'textarea',
        rows: 2,
      },
    ],
  },
  {
    titleKey: 'pgp.sectionAction',
    fields: [
      {
        key: 'action_plan_3y',
        labelKey: 'pgp.actionPlan3y',
        placeholderKey: 'pgp.actionPlan3yPlaceholder',
        type: 'textarea',
        rows: 4,
      },
    ],
  },
];

/** select талбарын хадгалагдсан утгыг харагдах label түлхүүр рүү буулгах. */
export function pgpSelectLabelKey(field: PgpField, value: string): string | undefined {
  return field.options?.find((o) => o.value === value)?.labelKey;
}
