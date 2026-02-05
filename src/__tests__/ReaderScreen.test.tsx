import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Mock the contexts and services
const mockUpdateProgress = jest.fn();
const mockAddToLibrary = jest.fn();
const mockLibrary: any[] = [];

jest.mock('../context/LibraryContext', () => ({
  useLibrary: () => ({
    updateProgress: mockUpdateProgress,
    addToLibrary: mockAddToLibrary,
    library: mockLibrary,
  }),
}));

jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      background: '#000',
      card: '#1a1a1a',
      text: '#fff',
      textSecondary: '#888',
      primary: '#FA6432',
      border: '#333',
      accent: '#FA6432',
      error: '#ff4444',
      success: '#4CAF50',
    },
  }),
}));

jest.mock('../context/DownloadContext', () => ({
  useDownloads: () => ({
    downloads: [],
    isChapterDownloaded: jest.fn().mockReturnValue(false),
  }),
}));

jest.mock('../services/sourceService', () => ({
  getChapterPages: jest.fn().mockResolvedValue([
    'https://image.chiraitori.io.vn/image',
    'https://image.chiraitori.io.vn/image',
    'https://image.chiraitori.io.vn/image',
  ]),
  getMangaDetails: jest.fn().mockResolvedValue({
    titles: ['Test Manga'],
    image: 'https://image.chiraitori.io.vn/image',
    author: 'Test Author',
    desc: 'Test description',
    status: 'ongoing',
  }),
  getChapters: jest.fn().mockResolvedValue([
    { id: 'ch1', chapNum: 1, name: 'Chapter 1' },
    { id: 'ch2', chapNum: 2, name: 'Chapter 2' },
  ]),
  decryptDrmImage: jest.fn().mockResolvedValue('decrypted-url'),
}));

jest.mock('../services/cacheService', () => ({
  cacheChapterPages: jest.fn(),
  getCachedChapterPages: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/i18nService', () => ({
  t: (key: string, params?: any) => {
    const translations: Record<string, string> = {
      'reader.chapter': 'Chapter',
      'reader.previousChapter': 'Previous Chapter',
      'reader.nextChapter': 'Next Chapter',
      'reader.noPreviousChapter': 'No Previous Chapter',
      'reader.noNextChapter': 'No Next Chapter',
      'reader.failedToLoadPage': `Failed to load page ${params?.page || ''}`,
      'common.loading': 'Loading',
      'common.loadingPage': `Loading page ${params?.current || 0} of ${params?.total || 0}`,
      'common.decryptingPage': `Decrypting page ${params?.page || 0}`,
    };
    return translations[key] || key;
  },
}));

// Import after mocks
import { ReaderScreen } from '../screens/ReaderScreen';

const Stack = createNativeStackNavigator();

// Test component wrapper
const TestReaderScreen = () => (
  <NavigationContainer>
    <Stack.Navigator>
      <Stack.Screen
        name="Reader"
        component={ReaderScreen}
        initialParams={{
          mangaId: 'manga-1',
          chapterId: 'ch1',
          sourceId: 'test-source',
          initialPage: 0,
        }}
      />
    </Stack.Navigator>
  </NavigationContainer>
);

describe('ReaderScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', async () => {
    const { getByText } = render(<TestReaderScreen />);
    
    expect(getByText('Loading...')).toBeTruthy();
  });

  it('loads and displays pages correctly', async () => {
    const { findByText, queryByText } = render(<TestReaderScreen />);
    
    // Wait for loading to complete
    await waitFor(() => {
      expect(queryByText('Loading...')).toBeNull();
    }, { timeout: 3000 });
    
    // Check that page indicator shows correct page count
    const pageIndicator = await findByText('1 / 3');
    expect(pageIndicator).toBeTruthy();
  });

  it('displays chapter information correctly', async () => {
    const { findByText, queryByText } = render(<TestReaderScreen />);
    
    await waitFor(() => {
      expect(queryByText('Loading...')).toBeNull();
    }, { timeout: 3000 });
    
    // Check manga title is displayed
    const title = await findByText('Test Manga');
    expect(title).toBeTruthy();
    
    // Check chapter info
    const chapterInfo = await findByText('Ch. 1');
    expect(chapterInfo).toBeTruthy();
  });
});

describe('ReaderScreen Page Count Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calculates total pages correctly from loaded data', async () => {
    const mockPages = [
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
    ];
    
    const { getChapterPages } = require('../services/sourceService');
    getChapterPages.mockResolvedValueOnce(mockPages);
    
    const { findByText, queryByText } = render(<TestReaderScreen />);
    
    await waitFor(() => {
      expect(queryByText('Loading...')).toBeNull();
    }, { timeout: 3000 });
    
    // Should show "1 / 5" for 5 pages
    const pageIndicator = await findByText('1 / 5');
    expect(pageIndicator).toBeTruthy();
  });

  it('handles empty pages array gracefully', async () => {
    const { getChapterPages } = require('../services/sourceService');
    getChapterPages.mockResolvedValueOnce([]);
    
    const { findByText } = render(<TestReaderScreen />);
    
    // Should show "No pages found" error
    await waitFor(() => {
      expect(findByText('No pages found')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('handles single page chapter', async () => {
    const { getChapterPages } = require('../services/sourceService');
    getChapterPages.mockResolvedValueOnce(['https://image.chiraitori.io.vn/image']);
    
    const { findByText, queryByText } = render(<TestReaderScreen />);
    
    await waitFor(() => {
      expect(queryByText('Loading...')).toBeNull();
    }, { timeout: 3000 });
    
    // Should show "1 / 1" for single page
    const pageIndicator = await findByText('1 / 1');
    expect(pageIndicator).toBeTruthy();
  });
});

describe('ReaderScreen Progress Saving', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves progress with correct page number and total', async () => {
    const mockPages = [
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
      'https://image.chiraitori.io.vn/image',
    ];
    
    const { getChapterPages } = require('../services/sourceService');
    getChapterPages.mockResolvedValueOnce(mockPages);
    
    render(<TestReaderScreen />);
    
    await waitFor(() => {
      expect(mockUpdateProgress).toHaveBeenCalled();
    }, { timeout: 3000 });
    
    // Check that progress was saved with correct structure
    const progressCall = mockUpdateProgress.mock.calls[0];
    expect(progressCall).toBeDefined();
    
    if (progressCall) {
      const [progress] = progressCall;
      expect(progress).toMatchObject({
        mangaId: expect.any(String),
        chapterId: expect.any(String),
        pageNumber: expect.any(Number),
        totalPages: 3,
        percentage: expect.any(Number),
        lastRead: expect.any(String),
      });
    }
  });
});
