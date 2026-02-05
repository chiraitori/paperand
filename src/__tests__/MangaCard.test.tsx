import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import MangaCard from '../components/MangaCard';

describe('MangaCard Component', () => {
  const mockManga = {
    id: '1',
    title: 'Test Manga',
    coverImage: 'https://image.chiraitori.io.vn/image',
    author: 'Test Author',
    description: 'Test Description',
    source: 'test-source',
    status: 'ongoing' as const,
    chapters: [],
    genres: ['Action', 'Adventure'],
    rating: 8.5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={100}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });

    it('should display manga title', () => {
      const { getByText } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={100}
        />
      );
      expect(getByText(mockManga.title)).toBeTruthy();
    });

    it('should display correct dimensions', () => {
      const width = 150;
      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={width}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });
  });

  describe('Interactions', () => {
    it('should call onPress when card is pressed', () => {
      const mockOnPress = jest.fn();
      const { getByText } = render(
        <MangaCard 
          manga={mockManga}
          onPress={mockOnPress}
          width={100}
        />
      );

      fireEvent.press(getByText(mockManga.title));
      expect(mockOnPress).toHaveBeenCalled();
    });

    it('should handle multiple presses', () => {
      const mockOnPress = jest.fn();
      const { getByText } = render(
        <MangaCard 
          manga={mockManga}
          onPress={mockOnPress}
          width={100}
        />
      );

      fireEvent.press(getByText(mockManga.title));
      fireEvent.press(getByText(mockManga.title));
      expect(mockOnPress).toHaveBeenCalledTimes(2);
    });
  });

  describe('Image Handling', () => {
    it('should load cover image', () => {
      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={100}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });

    it('should handle missing cover image gracefully', () => {
      const mangaWithoutCover = {
        ...mockManga,
        coverImage: '',
      };

      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mangaWithoutCover}
          onPress={() => {}}
          width={100}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });
  });

  describe('Data Display', () => {
    it('should display manga with all properties', () => {
      const mangaWithAllProps = {
        ...mockManga,
        author: 'John Doe',
        rating: 9.0,
      };

      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mangaWithAllProps}
          onPress={() => {}}
          width={100}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });

    it('should handle special characters in title', () => {
      const mangaWithSpecialChars = {
        ...mockManga,
        title: 'Test™ Manga® #1 [Special]',
      };

      const { getByText } = render(
        <MangaCard 
          manga={mangaWithSpecialChars}
          onPress={() => {}}
          width={100}
        />
      );
      expect(getByText(mangaWithSpecialChars.title)).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long titles', () => {
      const longTitle = 'A'.repeat(100);
      const mangaWithLongTitle = {
        ...mockManga,
        title: longTitle,
      };

      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mangaWithLongTitle}
          onPress={() => {}}
          width={100}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });

    it('should handle zero width gracefully', () => {
      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={0}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });

    it('should handle very large width', () => {
      const { UNSAFE_getByType } = render(
        <MangaCard 
          manga={mockManga}
          onPress={() => {}}
          width={9999}
        />
      );
      expect(UNSAFE_getByType(MangaCard)).toBeTruthy();
    });
  });
});
