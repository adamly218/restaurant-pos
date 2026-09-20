import { describe, expect, it } from 'vitest';
import { resolveMenuAwareData } from '@/lib/menu.resolver.ts';

describe('resolveMenuAwareData priority', () => {
  it('sorts dishes and categories by priority when no timed menu is active', () => {
    const result = resolveMenuAwareData({
      categories: [
        { id: 'category:c', name: 'C', priority: 3 } as any,
        { id: 'category:a', name: 'A', priority: 1 } as any,
        { id: 'category:b', name: 'B', priority: 2 } as any,
      ],
      dishes: [
        {
          id: 'menu_item:c',
          name: 'C',
          priority: 3,
          categories: [{ id: 'category:c', name: 'C', priority: 3 }],
        } as any,
        {
          id: 'menu_item:a',
          name: 'A',
          priority: 1,
          categories: [{ id: 'category:a', name: 'A', priority: 1 }],
        } as any,
        {
          id: 'menu_item:b',
          name: 'B',
          priority: 2,
          categories: [{ id: 'category:b', name: 'B', priority: 2 }],
        } as any,
      ],
      menus: [],
    });

    expect(result.dishes.map((d) => d.name)).toEqual(['A', 'B', 'C']);
    expect(result.categories.map((c) => c.name)).toEqual(['A', 'B', 'C']);
  });

  it('sorts dishes by priority when a timed menu filters the catalog', () => {
    const result = resolveMenuAwareData({
      categories: [
        { id: 'category:a', name: 'A', priority: 1 } as any,
        { id: 'category:b', name: 'B', priority: 2 } as any,
      ],
      dishes: [
        {
          id: 'menu_item:b',
          name: 'B',
          priority: 2,
          price: 2,
          categories: [{ id: 'category:b', name: 'B', priority: 2 }],
        } as any,
        {
          id: 'menu_item:a',
          name: 'A',
          priority: 1,
          price: 1,
          categories: [{ id: 'category:a', name: 'A', priority: 1 }],
        } as any,
      ],
      menus: [
        {
          id: 'menu:lunch',
          name: 'Lunch',
          active: true,
          items: [
            {
              id: 'menu_menu_item:1',
              active: true,
              menu_item: { id: 'menu_item:b', name: 'B', price: 2, priority: 2 },
            },
            {
              id: 'menu_menu_item:2',
              active: true,
              menu_item: { id: 'menu_item:a', name: 'A', price: 1, priority: 1 },
            },
          ],
        } as any,
      ],
      // Midday so menus without time windows stay active.
      now: new Date('2026-09-18T12:00:00'),
    });

    expect(result.hasActiveMenus).toBe(true);
    expect(result.dishes.map((d) => d.name)).toEqual(['A', 'B']);
    expect(result.categories.map((c) => c.name)).toEqual(['A', 'B']);
  });
});
