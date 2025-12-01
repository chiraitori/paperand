import { Manga, Chapter, Page, MangaSource } from '../types';

// Available manga sources
export const mangaSources: MangaSource[] = [
  { id: 'paperback', name: 'Paperback', icon: '📚', baseUrl: 'https://paperback.moe' },
  { id: 'batoto', name: 'Bato.To', icon: '🦇', baseUrl: 'https://bato.to' },
  { id: 'mangafox', name: 'MangaFox', icon: '🦊', baseUrl: 'https://mangafox.me' },
  { id: 'truyenqq', name: 'TruyenQQ', icon: '📖', baseUrl: 'https://truyenqq.com' },
];

// Mock manga data for demonstration
export const mockMangaList: Manga[] = [
  {
    id: '1',
    title: 'Getting Started with Paperback',
    author: 'Paperback Team',
    artist: 'Paperback Team',
    description: 'Welcome to Paperback! This guide will help you get started with the app.',
    coverImage: 'https://picsum.photos/seed/paperback1/300/450',
    genres: ['Guide', 'Tutorial'],
    status: 'completed',
    rating: 5.0,
    lastUpdated: '2024-12-01',
    chapters: generateChapters('1', 5),
    source: 'paperback',
  },
  {
    id: '2',
    title: 'Adventure Quest',
    author: 'Taro Yamamoto',
    artist: 'Yuki Tanaka',
    description: 'A young hero embarks on an epic journey to save the world from darkness.',
    coverImage: 'https://picsum.photos/seed/manga1/300/450',
    genres: ['Action', 'Adventure', 'Fantasy'],
    status: 'ongoing',
    rating: 4.5,
    lastUpdated: '2024-12-01',
    chapters: generateChapters('2', 50),
    source: 'batoto',
  },
  {
    id: '3',
    title: 'Slice of Life',
    author: 'Hanako Suzuki',
    description: 'Follow the daily adventures of a group of high school friends.',
    coverImage: 'https://picsum.photos/seed/manga2/300/450',
    genres: ['Slice of Life', 'Comedy', 'Romance'],
    status: 'ongoing',
    rating: 4.2,
    lastUpdated: '2024-11-28',
    chapters: generateChapters('3', 75),
    source: 'mangafox',
  },
  {
    id: '4',
    title: 'Dark Knights',
    author: 'Kenji Sato',
    artist: 'Mika Watanabe',
    description: 'In a world where demons roam free, a secret order of knights fights.',
    coverImage: 'https://picsum.photos/seed/manga3/300/450',
    genres: ['Action', 'Dark Fantasy', 'Supernatural'],
    status: 'completed',
    rating: 4.8,
    lastUpdated: '2024-10-15',
    chapters: generateChapters('4', 120),
    source: 'truyenqq',
  },
  {
    id: '5',
    title: 'Robot Dreams',
    author: 'Akira Hayashi',
    description: 'In the year 2150, robots have developed consciousness.',
    coverImage: 'https://picsum.photos/seed/manga4/300/450',
    genres: ['Sci-Fi', 'Drama', 'Psychological'],
    status: 'ongoing',
    rating: 4.6,
    lastUpdated: '2024-11-30',
    chapters: generateChapters('5', 35),
    source: 'batoto',
  },
  {
    id: '6',
    title: 'Cooking Master',
    author: 'Yui Nakamura',
    artist: 'Riku Ito',
    description: 'A talented chef enters the world of competitive cooking.',
    coverImage: 'https://picsum.photos/seed/manga5/300/450',
    genres: ['Cooking', 'Drama', 'Competition'],
    status: 'ongoing',
    rating: 4.3,
    lastUpdated: '2024-11-25',
    chapters: generateChapters('6', 88),
    source: 'mangafox',
  },
  {
    id: '7',
    title: 'Spirit World',
    author: 'Sakura Miyamoto',
    description: 'A teenager discovers they can see spirits.',
    coverImage: 'https://picsum.photos/seed/manga6/300/450',
    genres: ['Supernatural', 'Mystery', 'Coming of Age'],
    status: 'ongoing',
    rating: 4.4,
    lastUpdated: '2024-11-29',
    chapters: generateChapters('7', 62),
    source: 'paperback',
  },
  {
    id: '8',
    title: 'Sports Glory',
    author: 'Daiki Yamada',
    artist: 'Emi Takahashi',
    description: 'An underdog basketball team fights for the championship.',
    coverImage: 'https://picsum.photos/seed/manga7/300/450',
    genres: ['Sports', 'Drama', 'Motivation'],
    status: 'completed',
    rating: 4.7,
    lastUpdated: '2024-09-20',
    chapters: generateChapters('8', 200),
    source: 'truyenqq',
  },
];

function generateChapters(mangaId: string, count: number): Chapter[] {
  const chapters: Chapter[] = [];
  for (let i = 1; i <= count; i++) {
    chapters.push({
      id: `${mangaId}-ch-${i}`,
      mangaId,
      number: i,
      title: `Chapter ${i}`,
      pages: generatePages(`${mangaId}-ch-${i}`, 20),
      releaseDate: getRandomDate(),
      isRead: false,
    });
  }
  return chapters;
}

function generatePages(chapterId: string, count: number): Page[] {
  const pages: Page[] = [];
  for (let i = 1; i <= count; i++) {
    pages.push({
      id: `${chapterId}-page-${i}`,
      chapterId,
      pageNumber: i,
      imageUrl: `https://picsum.photos/seed/${chapterId}-${i}/800/1200`,
    });
  }
  return pages;
}

function getRandomDate(): string {
  const start = new Date(2024, 0, 1);
  const end = new Date();
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().split('T')[0];
}

// API-like functions
export const getMangaList = async (): Promise<Manga[]> => {
  await new Promise(resolve => setTimeout(resolve, 500));
  return mockMangaList;
};

export const getMangaBySource = async (sourceId: string): Promise<Manga[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  return mockMangaList.filter(manga => manga.source === sourceId);
};

export const getRecentlyAdded = async (sourceId: string): Promise<Manga[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  const sourceManga = mockMangaList.filter(manga => manga.source === sourceId);
  return sourceManga.slice(0, 5);
};

export const getRecentlyUpdated = async (sourceId: string): Promise<Manga[]> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  const sourceManga = mockMangaList.filter(manga => manga.source === sourceId);
  return sourceManga.sort((a, b) => 
    new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  ).slice(0, 5);
};

export const getMangaById = async (id: string): Promise<Manga | undefined> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  return mockMangaList.find(manga => manga.id === id);
};

export const getChapterById = async (mangaId: string, chapterId: string): Promise<Chapter | undefined> => {
  await new Promise(resolve => setTimeout(resolve, 200));
  const manga = mockMangaList.find(m => m.id === mangaId);
  return manga?.chapters.find(ch => ch.id === chapterId);
};

export const searchManga = async (query: string): Promise<Manga[]> => {
  await new Promise(resolve => setTimeout(resolve, 400));
  const lowerQuery = query.toLowerCase();
  return mockMangaList.filter(manga =>
    manga.title.toLowerCase().includes(lowerQuery) ||
    manga.author.toLowerCase().includes(lowerQuery) ||
    manga.genres.some(genre => genre.toLowerCase().includes(lowerQuery))
  );
};

export const getGenres = (): string[] => {
  const allGenres = mockMangaList.flatMap(manga => manga.genres);
  return [...new Set(allGenres)].sort();
};
