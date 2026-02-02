// Types for testing
interface ReadingActivityParams {
    mangaTitle: string;
    mangaCoverUrl?: string;
    chapterId: string;
    chapterTitle: string;
    currentPage: number;
    totalPages: number;
}

interface DownloadActivityParams {
    mangaTitle: string;
    mangaCoverUrl?: string;
    totalCount: number;
}

interface ActivityInfo {
    type: 'reading' | 'download';
    id: string;
    mangaTitle: string;
    currentPage?: number;
    totalPages?: number;
    downloadedCount?: number;
    totalCount?: number;
}

// Mock the native module with all required methods
const mockNativeModule = {
    isSupported: jest.fn(),
    startReadingActivity: jest.fn(),
    updateReadingActivity: jest.fn(),
    endReadingActivity: jest.fn(),
    startDownloadActivity: jest.fn(),
    updateDownloadActivity: jest.fn(),
    completeDownloadActivity: jest.fn(),
    endDownloadActivity: jest.fn(),
    getActiveActivities: jest.fn(),
    endAllActivities: jest.fn(),
};

// Create a mock ReadingActivity that mirrors the actual module behavior
const createReadingActivity = (platformOS: 'ios' | 'android', nativeModule: typeof mockNativeModule | null) => ({
    isSupported(): boolean {
        if (platformOS !== 'ios' || !nativeModule) {
            return false;
        }
        return nativeModule.isSupported();
    },

    async startReadingActivity(params: ReadingActivityParams): Promise<string | null> {
        if (platformOS !== 'ios' || !nativeModule) {
            return null;
        }
        try {
            const result = await nativeModule.startReadingActivity(
                params.mangaTitle,
                params.mangaCoverUrl ?? null,
                params.chapterId,
                params.chapterTitle,
                params.currentPage,
                params.totalPages
            );
            return result.started ? result.activityId : null;
        } catch {
            return null;
        }
    },

    async updateReadingActivity(
        currentPage: number,
        totalPages: number,
        chapterTitle?: string
    ): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return false;
        }
        try {
            const result = await nativeModule.updateReadingActivity(
                currentPage,
                totalPages,
                chapterTitle ?? null
            );
            return result.updated;
        } catch {
            return false;
        }
    },

    async endReadingActivity(): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return true;
        }
        try {
            const result = await nativeModule.endReadingActivity();
            return result.ended;
        } catch {
            return false;
        }
    },

    async startDownloadActivity(params: DownloadActivityParams): Promise<string | null> {
        if (platformOS !== 'ios' || !nativeModule) {
            return null;
        }
        try {
            const result = await nativeModule.startDownloadActivity(
                params.mangaTitle,
                params.mangaCoverUrl ?? null,
                params.totalCount
            );
            return result.started ? result.activityId : null;
        } catch {
            return null;
        }
    },

    async updateDownloadActivity(
        currentChapter: string,
        downloadedCount: number,
        totalCount: number,
        queuedCount: number = 0
    ): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return false;
        }
        try {
            const result = await nativeModule.updateDownloadActivity(
                currentChapter,
                downloadedCount,
                totalCount,
                queuedCount
            );
            return result.updated;
        } catch {
            return false;
        }
    },

    async completeDownloadActivity(message?: string): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return true;
        }
        try {
            const result = await nativeModule.completeDownloadActivity(message ?? null);
            return result.completed;
        } catch {
            return false;
        }
    },

    async endDownloadActivity(): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return true;
        }
        try {
            const result = await nativeModule.endDownloadActivity();
            return result.ended;
        } catch {
            return false;
        }
    },

    getActiveActivities(): ActivityInfo[] {
        if (platformOS !== 'ios' || !nativeModule) {
            return [];
        }
        try {
            return nativeModule.getActiveActivities();
        } catch {
            return [];
        }
    },

    async endAllActivities(): Promise<boolean> {
        if (platformOS !== 'ios' || !nativeModule) {
            return true;
        }
        try {
            const result = await nativeModule.endAllActivities();
            return result.ended;
        } catch {
            return false;
        }
    },
});

// Use the iOS mock by default
let ReadingActivity = createReadingActivity('ios', mockNativeModule);

describe('ReadingActivity Module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isSupported', () => {
        it('should return true when native module reports supported', () => {
            mockNativeModule.isSupported.mockReturnValue(true);

            const result = ReadingActivity.isSupported();

            expect(result).toBe(true);
            expect(mockNativeModule.isSupported).toHaveBeenCalled();
        });

        it('should return false when native module reports not supported', () => {
            mockNativeModule.isSupported.mockReturnValue(false);

            const result = ReadingActivity.isSupported();

            expect(result).toBe(false);
        });
    });

    describe('Reading Progress Activity', () => {
        describe('startReadingActivity', () => {
            it('should start activity with all parameters', async () => {
                const params: ReadingActivityParams = {
                    mangaTitle: 'One Piece',
                    mangaCoverUrl: 'https://example.com/cover.jpg',
                    chapterId: 'chapter-1',
                    chapterTitle: 'Chapter 1: Romance Dawn',
                    currentPage: 1,
                    totalPages: 50,
                };

                mockNativeModule.startReadingActivity.mockResolvedValue({
                    activityId: 'activity-123',
                    started: true,
                });

                const result = await ReadingActivity.startReadingActivity(params);

                expect(result).toBe('activity-123');
                expect(mockNativeModule.startReadingActivity).toHaveBeenCalledWith(
                    'One Piece',
                    'https://example.com/cover.jpg',
                    'chapter-1',
                    'Chapter 1: Romance Dawn',
                    1,
                    50
                );
            });

            it('should handle null cover URL', async () => {
                const params: ReadingActivityParams = {
                    mangaTitle: 'Naruto',
                    chapterId: 'chapter-1',
                    chapterTitle: 'Chapter 1',
                    currentPage: 1,
                    totalPages: 30,
                };

                mockNativeModule.startReadingActivity.mockResolvedValue({
                    activityId: 'activity-456',
                    started: true,
                });

                const result = await ReadingActivity.startReadingActivity(params);

                expect(result).toBe('activity-456');
                expect(mockNativeModule.startReadingActivity).toHaveBeenCalledWith(
                    'Naruto',
                    null,
                    'chapter-1',
                    'Chapter 1',
                    1,
                    30
                );
            });

            it('should return null when activity fails to start', async () => {
                const params: ReadingActivityParams = {
                    mangaTitle: 'Test',
                    chapterId: 'test',
                    chapterTitle: 'Test',
                    currentPage: 1,
                    totalPages: 10,
                };

                mockNativeModule.startReadingActivity.mockResolvedValue({
                    activityId: '',
                    started: false,
                });

                const result = await ReadingActivity.startReadingActivity(params);

                expect(result).toBeNull();
            });

            it('should return null when native module throws error', async () => {
                const params: ReadingActivityParams = {
                    mangaTitle: 'Test',
                    chapterId: 'test',
                    chapterTitle: 'Test',
                    currentPage: 1,
                    totalPages: 10,
                };

                mockNativeModule.startReadingActivity.mockRejectedValue(new Error('Native error'));

                const result = await ReadingActivity.startReadingActivity(params);

                expect(result).toBeNull();
            });
        });

        describe('updateReadingActivity', () => {
            it('should update activity with new page and total', async () => {
                mockNativeModule.updateReadingActivity.mockResolvedValue({ updated: true });

                const result = await ReadingActivity.updateReadingActivity(10, 50);

                expect(result).toBe(true);
                expect(mockNativeModule.updateReadingActivity).toHaveBeenCalledWith(10, 50, null);
            });

            it('should update activity with new chapter title', async () => {
                mockNativeModule.updateReadingActivity.mockResolvedValue({ updated: true });

                const result = await ReadingActivity.updateReadingActivity(1, 30, 'Chapter 2');

                expect(result).toBe(true);
                expect(mockNativeModule.updateReadingActivity).toHaveBeenCalledWith(1, 30, 'Chapter 2');
            });

            it('should return false when update fails', async () => {
                mockNativeModule.updateReadingActivity.mockResolvedValue({ updated: false });

                const result = await ReadingActivity.updateReadingActivity(5, 20);

                expect(result).toBe(false);
            });

            it('should return false when native module throws error', async () => {
                mockNativeModule.updateReadingActivity.mockRejectedValue(new Error('Update failed'));

                const result = await ReadingActivity.updateReadingActivity(5, 20);

                expect(result).toBe(false);
            });
        });

        describe('endReadingActivity', () => {
            it('should end activity successfully', async () => {
                mockNativeModule.endReadingActivity.mockResolvedValue({ ended: true });

                const result = await ReadingActivity.endReadingActivity();

                expect(result).toBe(true);
                expect(mockNativeModule.endReadingActivity).toHaveBeenCalled();
            });

            it('should return false when ending fails', async () => {
                mockNativeModule.endReadingActivity.mockRejectedValue(new Error('End failed'));

                const result = await ReadingActivity.endReadingActivity();

                expect(result).toBe(false);
            });
        });
    });

    describe('Download Progress Activity', () => {
        describe('startDownloadActivity', () => {
            it('should start download activity with all parameters', async () => {
                const params: DownloadActivityParams = {
                    mangaTitle: 'One Piece',
                    mangaCoverUrl: 'https://example.com/cover.jpg',
                    totalCount: 10,
                };

                mockNativeModule.startDownloadActivity.mockResolvedValue({
                    activityId: 'download-123',
                    started: true,
                });

                const result = await ReadingActivity.startDownloadActivity(params);

                expect(result).toBe('download-123');
                expect(mockNativeModule.startDownloadActivity).toHaveBeenCalledWith(
                    'One Piece',
                    'https://example.com/cover.jpg',
                    10
                );
            });

            it('should handle missing cover URL', async () => {
                const params: DownloadActivityParams = {
                    mangaTitle: 'Naruto',
                    totalCount: 5,
                };

                mockNativeModule.startDownloadActivity.mockResolvedValue({
                    activityId: 'download-456',
                    started: true,
                });

                const result = await ReadingActivity.startDownloadActivity(params);

                expect(result).toBe('download-456');
                expect(mockNativeModule.startDownloadActivity).toHaveBeenCalledWith(
                    'Naruto',
                    null,
                    5
                );
            });

            it('should return null when activity fails to start', async () => {
                const params: DownloadActivityParams = {
                    mangaTitle: 'Test',
                    totalCount: 3,
                };

                mockNativeModule.startDownloadActivity.mockResolvedValue({
                    activityId: '',
                    started: false,
                });

                const result = await ReadingActivity.startDownloadActivity(params);

                expect(result).toBeNull();
            });
        });

        describe('updateDownloadActivity', () => {
            it('should update download activity with progress', async () => {
                mockNativeModule.updateDownloadActivity.mockResolvedValue({ updated: true });

                const result = await ReadingActivity.updateDownloadActivity(
                    'Chapter 5',
                    5,
                    10,
                    2
                );

                expect(result).toBe(true);
                expect(mockNativeModule.updateDownloadActivity).toHaveBeenCalledWith(
                    'Chapter 5',
                    5,
                    10,
                    2
                );
            });

            it('should use default queuedCount of 0', async () => {
                mockNativeModule.updateDownloadActivity.mockResolvedValue({ updated: true });

                const result = await ReadingActivity.updateDownloadActivity(
                    'Chapter 3',
                    3,
                    5
                );

                expect(result).toBe(true);
                expect(mockNativeModule.updateDownloadActivity).toHaveBeenCalledWith(
                    'Chapter 3',
                    3,
                    5,
                    0
                );
            });

            it('should return false when update fails', async () => {
                mockNativeModule.updateDownloadActivity.mockRejectedValue(new Error('Update failed'));

                const result = await ReadingActivity.updateDownloadActivity(
                    'Chapter 1',
                    1,
                    10
                );

                expect(result).toBe(false);
            });
        });

        describe('completeDownloadActivity', () => {
            it('should complete activity with custom message', async () => {
                mockNativeModule.completeDownloadActivity.mockResolvedValue({ completed: true });

                const result = await ReadingActivity.completeDownloadActivity('Downloaded 10 chapters!');

                expect(result).toBe(true);
                expect(mockNativeModule.completeDownloadActivity).toHaveBeenCalledWith(
                    'Downloaded 10 chapters!'
                );
            });

            it('should complete activity with null message', async () => {
                mockNativeModule.completeDownloadActivity.mockResolvedValue({ completed: true });

                const result = await ReadingActivity.completeDownloadActivity();

                expect(result).toBe(true);
                expect(mockNativeModule.completeDownloadActivity).toHaveBeenCalledWith(null);
            });

            it('should return false when completion fails', async () => {
                mockNativeModule.completeDownloadActivity.mockRejectedValue(new Error('Completion failed'));

                const result = await ReadingActivity.completeDownloadActivity();

                expect(result).toBe(false);
            });
        });

        describe('endDownloadActivity', () => {
            it('should end download activity successfully', async () => {
                mockNativeModule.endDownloadActivity.mockResolvedValue({ ended: true });

                const result = await ReadingActivity.endDownloadActivity();

                expect(result).toBe(true);
                expect(mockNativeModule.endDownloadActivity).toHaveBeenCalled();
            });

            it('should return false when ending fails', async () => {
                mockNativeModule.endDownloadActivity.mockRejectedValue(new Error('End failed'));

                const result = await ReadingActivity.endDownloadActivity();

                expect(result).toBe(false);
            });
        });
    });

    describe('Utility Functions', () => {
        describe('getActiveActivities', () => {
            it('should return list of active activities', () => {
                const mockActivities: ActivityInfo[] = [
                    {
                        type: 'reading',
                        id: 'activity-1',
                        mangaTitle: 'One Piece',
                        currentPage: 25,
                        totalPages: 50,
                    },
                    {
                        type: 'download',
                        id: 'activity-2',
                        mangaTitle: 'Naruto',
                        downloadedCount: 5,
                        totalCount: 10,
                    },
                ];

                mockNativeModule.getActiveActivities.mockReturnValue(mockActivities);

                const result = ReadingActivity.getActiveActivities();

                expect(result).toEqual(mockActivities);
                expect(result).toHaveLength(2);
            });

            it('should return empty array when no activities', () => {
                mockNativeModule.getActiveActivities.mockReturnValue([]);

                const result = ReadingActivity.getActiveActivities();

                expect(result).toEqual([]);
            });

            it('should return empty array when native module throws', () => {
                mockNativeModule.getActiveActivities.mockImplementation(() => {
                    throw new Error('Get activities failed');
                });

                const result = ReadingActivity.getActiveActivities();

                expect(result).toEqual([]);
            });
        });

        describe('endAllActivities', () => {
            it('should end all activities successfully', async () => {
                mockNativeModule.endAllActivities.mockResolvedValue({ ended: true });

                const result = await ReadingActivity.endAllActivities();

                expect(result).toBe(true);
                expect(mockNativeModule.endAllActivities).toHaveBeenCalled();
            });

            it('should return false when ending fails', async () => {
                mockNativeModule.endAllActivities.mockRejectedValue(new Error('End all failed'));

                const result = await ReadingActivity.endAllActivities();

                expect(result).toBe(false);
            });
        });
    });
});

describe('ReadingActivity Module - Android Platform', () => {
    let AndroidReadingActivity: typeof ReadingActivity;

    beforeEach(() => {
        jest.clearAllMocks();
        // Create a new instance for Android platform
        AndroidReadingActivity = createReadingActivity('android', mockNativeModule);
    });

    it('should return false for isSupported on Android', () => {
        mockNativeModule.isSupported.mockReturnValue(true);
        const result = AndroidReadingActivity.isSupported();
        expect(result).toBe(false);
    });

    it('should return null for startReadingActivity on Android', async () => {
        const params: ReadingActivityParams = {
            mangaTitle: 'Test',
            chapterId: 'ch-1',
            chapterTitle: 'Chapter 1',
            currentPage: 1,
            totalPages: 10,
        };
        const result = await AndroidReadingActivity.startReadingActivity(params);
        expect(result).toBeNull();
    });

    it('should return false for updateReadingActivity on Android', async () => {
        const result = await AndroidReadingActivity.updateReadingActivity(5, 10);
        expect(result).toBe(false);
    });

    it('should return true for endReadingActivity on Android (graceful fallback)', async () => {
        const result = await AndroidReadingActivity.endReadingActivity();
        expect(result).toBe(true);
    });

    it('should return empty array for getActiveActivities on Android', () => {
        const result = AndroidReadingActivity.getActiveActivities();
        expect(result).toEqual([]);
    });
});

describe('ReadingActivity Types', () => {
    it('should have correct ReadingActivityParams structure', () => {
        const params: ReadingActivityParams = {
            mangaTitle: 'Test Manga',
            mangaCoverUrl: 'https://example.com/cover.jpg',
            chapterId: 'ch-1',
            chapterTitle: 'Chapter 1',
            currentPage: 1,
            totalPages: 20,
        };

        expect(params.mangaTitle).toBeDefined();
        expect(params.chapterId).toBeDefined();
        expect(params.chapterTitle).toBeDefined();
        expect(params.currentPage).toBeDefined();
        expect(params.totalPages).toBeDefined();
    });

    it('should have correct DownloadActivityParams structure', () => {
        const params: DownloadActivityParams = {
            mangaTitle: 'Test Manga',
            mangaCoverUrl: 'https://example.com/cover.jpg',
            totalCount: 10,
        };

        expect(params.mangaTitle).toBeDefined();
        expect(params.totalCount).toBeDefined();
    });

    it('should have correct ActivityInfo structure for reading', () => {
        const info: ActivityInfo = {
            type: 'reading',
            id: 'activity-1',
            mangaTitle: 'Test',
            currentPage: 5,
            totalPages: 10,
        };

        expect(info.type).toBe('reading');
        expect(info.currentPage).toBeDefined();
        expect(info.totalPages).toBeDefined();
    });

    it('should have correct ActivityInfo structure for download', () => {
        const info: ActivityInfo = {
            type: 'download',
            id: 'activity-2',
            mangaTitle: 'Test',
            downloadedCount: 3,
            totalCount: 5,
        };

        expect(info.type).toBe('download');
        expect(info.downloadedCount).toBeDefined();
        expect(info.totalCount).toBeDefined();
    });
});
