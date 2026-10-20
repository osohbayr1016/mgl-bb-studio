import type { ReactNode } from 'react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from 'mgl-ui';

const Frame = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      padding: 24,
      borderRadius: 12,
      maxWidth: 520,
    }}
  >
    {children}
  </div>
);

export const FAQ = () => (
  <Frame>
    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'hsl(var(--muted-foreground))', marginBottom: 12 }}>
      Түгээмэл асуулт
    </p>
    <Accordion type="single" collapsible defaultValue="item-1">
      <AccordionItem value="item-1">
        <AccordionTrigger>Төсөл хэзээ дуусах вэ?</AccordionTrigger>
        <AccordionContent>
          Барилгын ажил 2026 оны 9-р сарын 15-нд дуусахаар төлөвлөгдсөн. Одоогийн гүйцэтгэл 72% байгаа тул хугацаа хэвийн явж байна.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Явцын тайланг хэрхэн харах вэ?</AccordionTrigger>
        <AccordionContent>
          Төслийн дэлгэрэнгүй хуудсанд орж "Тайлан" табыг сонгоно уу. PDF тайланг татаж авах боломжтой.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Блок бүрийн жин хэрхэн тооцоологддог вэ?</AccordionTrigger>
        <AccordionContent>
          Блок тус бүрийн жин нь эх төслийн доторх эзлэх хувиар тодорхойлогддог. Нийт жингийн нийлбэр 100% байх ёстой — энэ нь автоматаар шалгагддаг.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </Frame>
);

export const Inline = () => (
  <Frame>
    <Accordion type="multiple" defaultValue={['a', 'b']}>
      <AccordionItem value="a">
        <AccordionTrigger>Архитектурын зураг</AccordionTrigger>
        <AccordionContent>
          <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 2, fontSize: 13 }}>
            <li>A-001 · Ерөнхий байршлын зураг</li>
            <li>A-002 · 1-р давхрын төлөвлөгөө</li>
            <li>A-003 · Фасад</li>
          </ul>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Бүтцийн зураг</AccordionTrigger>
        <AccordionContent>
          <ul style={{ paddingLeft: 16, margin: 0, lineHeight: 2, fontSize: 13 }}>
            <li>S-001 · Суурийн зураг</li>
            <li>S-002 · Хүрээний план</li>
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </Frame>
);
