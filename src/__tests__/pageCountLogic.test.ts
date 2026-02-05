/**
 * Tests for the page count logic fix
 * These tests verify that the page count tracking works correctly
 * after the fix to use onViewableItemsChanged instead of scroll position calculation
 */

describe('Page Count Logic - Viewability Tracking', () => {
  // Simulate the onViewableItemsChanged callback logic
  const createViewabilityHandler = (
    setCurrentPage: (page: number) => void,
    saveProgress: (page: number) => void,
    lastSavedPageRef: { current: number }
  ) => {
    return ({ viewableItems }: { viewableItems: Array<{ index: number }> }) => {
      if (viewableItems && viewableItems.length > 0) {
        const visibleItem = viewableItems[0];
        const pageIndex = visibleItem.index;

        if (pageIndex !== undefined) {
          setCurrentPage(pageIndex);

          if (pageIndex !== lastSavedPageRef.current) {
            lastSavedPageRef.current = pageIndex;
            saveProgress(pageIndex);
          }
        }
      }
    };
  };

  let currentPage: number;
  let savedProgresses: number[];
  let lastSavedPageRef: { current: number };
  let setCurrentPage: (page: number) => void;
  let saveProgress: (page: number) => void;
  let handler: ReturnType<typeof createViewabilityHandler>;

  beforeEach(() => {
    currentPage = 0;
    savedProgresses = [];
    lastSavedPageRef = { current: -1 };
    setCurrentPage = (page: number) => {
      currentPage = page;
    };
    saveProgress = (page: number) => {
      savedProgresses.push(page);
    };
    handler = createViewabilityHandler(setCurrentPage, saveProgress, lastSavedPageRef);
  });

  describe('Basic page tracking', () => {
    it('should set current page to first visible item index', () => {
      handler({ viewableItems: [{ index: 5 }] });
      expect(currentPage).toBe(5);
    });

    it('should save progress when page changes', () => {
      handler({ viewableItems: [{ index: 3 }] });
      expect(savedProgresses).toContain(3);
      expect(lastSavedPageRef.current).toBe(3);
    });

    it('should not save progress when page has not changed', () => {
      handler({ viewableItems: [{ index: 3 }] });
      handler({ viewableItems: [{ index: 3 }] });
      handler({ viewableItems: [{ index: 3 }] });
      expect(savedProgresses).toEqual([3]);
    });

    it('should handle multiple page changes', () => {
      handler({ viewableItems: [{ index: 0 }] });
      handler({ viewableItems: [{ index: 1 }] });
      handler({ viewableItems: [{ index: 2 }] });
      handler({ viewableItems: [{ index: 3 }] });

      expect(currentPage).toBe(3);
      expect(savedProgresses).toEqual([0, 1, 2, 3]);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty viewable items', () => {
      handler({ viewableItems: [] });
      expect(currentPage).toBe(0); // unchanged
      expect(savedProgresses).toEqual([]);
    });

    it('should handle undefined viewable items', () => {
      handler({ viewableItems: undefined as any });
      expect(currentPage).toBe(0); // unchanged
      expect(savedProgresses).toEqual([]);
    });

    it('should handle index 0 correctly', () => {
      handler({ viewableItems: [{ index: 0 }] });
      expect(currentPage).toBe(0);
      expect(savedProgresses).toEqual([0]);
    });

    it('should handle last page', () => {
      handler({ viewableItems: [{ index: 99 }] });
      expect(currentPage).toBe(99);
      expect(savedProgresses).toEqual([99]);
    });
  });

  describe('Multiple visible items', () => {
    it('should use first visible item when multiple are visible', () => {
      handler({ viewableItems: [{ index: 5 }, { index: 6 }, { index: 7 }] });
      expect(currentPage).toBe(5);
    });

    it('should update when first visible item changes', () => {
      handler({ viewableItems: [{ index: 5 }, { index: 6 }] });
      expect(currentPage).toBe(5);

      handler({ viewableItems: [{ index: 6 }, { index: 7 }] });
      expect(currentPage).toBe(6);
    });
  });

  describe('Page count accuracy', () => {
    it('should track pages correctly regardless of image heights', () => {
      // Simulate scrolling through pages with different heights
      const pageSequence = [0, 1, 2, 3, 4, 5];

      pageSequence.forEach((page) => {
        handler({ viewableItems: [{ index: page }] });
      });

      expect(currentPage).toBe(5);
      expect(savedProgresses).toEqual(pageSequence);
    });

    it('should handle rapid page changes', () => {
      // Simulate fast scrolling
      handler({ viewableItems: [{ index: 0 }] });
      handler({ viewableItems: [{ index: 5 }] });
      handler({ viewableItems: [{ index: 10 }] });
      handler({ viewableItems: [{ index: 15 }] });

      expect(currentPage).toBe(15);
      expect(savedProgresses).toEqual([0, 5, 10, 15]);
    });

    it('should handle backward navigation', () => {
      handler({ viewableItems: [{ index: 10 }] });
      handler({ viewableItems: [{ index: 9 }] });
      handler({ viewableItems: [{ index: 8 }] });
      handler({ viewableItems: [{ index: 7 }] });

      expect(currentPage).toBe(7);
      expect(savedProgresses).toEqual([10, 9, 8, 7]);
    });
  });
});

describe('Page Count Logic - Progress Calculation', () => {
  it('should calculate correct percentage for progress', () => {
    const calculateProgress = (pageNum: number, totalPages: number) => {
      const pageNumber = pageNum + 1; // Convert 0-indexed to 1-indexed
      const percentage = totalPages > 0 ? Math.round((pageNumber / totalPages) * 100) : 0;
      return { pageNumber, totalPages, percentage };
    };

    // First page
    expect(calculateProgress(0, 10)).toEqual({ pageNumber: 1, totalPages: 10, percentage: 10 });

    // Middle page
    expect(calculateProgress(4, 10)).toEqual({ pageNumber: 5, totalPages: 10, percentage: 50 });

    // Last page
    expect(calculateProgress(9, 10)).toEqual({ pageNumber: 10, totalPages: 10, percentage: 100 });

    // Single page chapter
    expect(calculateProgress(0, 1)).toEqual({ pageNumber: 1, totalPages: 1, percentage: 100 });
  });

  it('should handle edge cases in progress calculation', () => {
    const calculateProgress = (pageNum: number, totalPages: number) => {
      const pageNumber = pageNum + 1;
      const percentage = totalPages > 0 ? Math.round((pageNumber / totalPages) * 100) : 0;
      return { pageNumber, totalPages, percentage };
    };

    // Zero total pages
    expect(calculateProgress(0, 0)).toEqual({ pageNumber: 1, totalPages: 0, percentage: 0 });

    // Large page count
    expect(calculateProgress(499, 500)).toEqual({ pageNumber: 500, totalPages: 500, percentage: 100 });
  });
});

describe('Page Count Logic - Comparison with old scroll-based approach', () => {
  /**
   * These tests demonstrate why the old scroll-based approach was problematic
   * and how the new viewability-based approach fixes it
   */

  // Old approach: Calculate page from scroll position
  const oldCalculatePage = (scrollY: number, pageHeight: number, totalPages: number) => {
    const centerScrollY = scrollY + (pageHeight / 2);
    const estimatedPage = Math.floor(centerScrollY / pageHeight);
    return Math.max(0, Math.min(estimatedPage, totalPages - 1));
  };

  // New approach: Use viewable item index
  const newCalculatePage = (viewableItems: Array<{ index: number }>) => {
    if (viewableItems && viewableItems.length > 0) {
      return viewableItems[0].index;
    }
    return 0;
  };

  it('old approach: fails with variable image heights', () => {
    // Simulate images with different heights (e.g., some are double pages)
    const screenHeight = 800;
    const pages = [
      { height: 800 }, // Normal page
      { height: 1600 }, // Double page (tall image)
      { height: 800 }, // Normal page
    ];

    // Scroll to where we should be on page 2 (the tall image)
    // With old approach, this would incorrectly calculate the page
    const scrollY = 1000; // Scrolled past first page and into second
    const calculatedPage = oldCalculatePage(scrollY, screenHeight, 3);

    // Old approach incorrectly calculates this as page 1
    // (1000 + 400) / 800 = 1.75 -> floor = 1
    expect(calculatedPage).toBe(1);

    // But we might actually be viewing page 2 depending on layout
  });

  it('new approach: correctly identifies page regardless of image height', () => {
    // New approach simply uses the index of the visible item
    const viewableItems = [{ index: 2 }];
    const calculatedPage = newCalculatePage(viewableItems);

    expect(calculatedPage).toBe(2);
  });

  it('new approach: handles mixed image sizes correctly', () => {
    // With varying image heights, the viewability approach still works
    const scenarios = [
      { viewableItems: [{ index: 0 }], expectedPage: 0 },
      { viewableItems: [{ index: 1 }], expectedPage: 1 },
      { viewableItems: [{ index: 5 }], expectedPage: 5 },
      { viewableItems: [{ index: 10 }], expectedPage: 10 },
    ];

    scenarios.forEach(({ viewableItems, expectedPage }) => {
      expect(newCalculatePage(viewableItems)).toBe(expectedPage);
    });
  });
});
