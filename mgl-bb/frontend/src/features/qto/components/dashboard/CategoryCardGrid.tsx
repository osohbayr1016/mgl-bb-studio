import { CategoryCard, type DashViewCard } from './CategoryCard';

/** Summary view — категорийн картуудын grid (default харагдац). */
export function CategoryCardGrid({ cards }: { cards: DashViewCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <CategoryCard key={card.cat.key} card={card} />
      ))}
    </div>
  );
}
