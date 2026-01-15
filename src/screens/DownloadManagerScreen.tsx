import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Platform,
    StatusBar,
    Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useDownloads } from '../context/DownloadContext';
import { t } from '../services/i18nService';
import { NativeDropdown } from '../components/NativeDropdown';
import { AppDialog } from '../components/AppDialog';
import { useDialog } from '../hooks/useDialog';
import { DownloadedChapter, DownloadJob, RootStackParamList } from '../types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
};

// Group downloads by manga
interface MangaGroup {
    mangaId: string;
    mangaTitle: string;
    mangaCover: string;
    sourceId?: string;
    chapters: DownloadedChapter[];
    totalSize: number;
}

// Group queue items by manga
interface QueueMangaGroup {
    mangaId: string;
    mangaTitle: string;
    mangaCover: string;
    jobs: DownloadJob[];
}

export const DownloadManagerScreen: React.FC = () => {
    const { theme } = useTheme();
    const navigation = useNavigation<NavigationProp>();
    const { dialogVisible, dialogConfig, showDialog, hideDialog } = useDialog();
    const {
        downloads,
        queue,
        deleteDownload,
        cancelDownload,
        pauseAll,
        resumeAll,
        isPaused,
    } = useDownloads();

    // Group downloads by manga
    const mangaGroups = useMemo((): MangaGroup[] => {
        const groups: Record<string, MangaGroup> = {};

        downloads.forEach(chapter => {
            if (!groups[chapter.mangaId]) {
                groups[chapter.mangaId] = {
                    mangaId: chapter.mangaId,
                    mangaTitle: chapter.mangaTitle,
                    mangaCover: chapter.mangaCover,
                    sourceId: chapter.sourceId,
                    chapters: [],
                    totalSize: 0,
                };
            }
            groups[chapter.mangaId].chapters.push(chapter);
            groups[chapter.mangaId].totalSize += chapter.size;
        });

        // Sort chapters within each group by chapter title
        Object.values(groups).forEach(group => {
            group.chapters.sort((a, b) => a.chapterTitle.localeCompare(b.chapterTitle, undefined, { numeric: true }));
        });

        return Object.values(groups).sort((a, b) => a.mangaTitle.localeCompare(b.mangaTitle));
    }, [downloads]);

    // Group queue items by manga
    const queueGroups = useMemo((): QueueMangaGroup[] => {
        const groups: Record<string, QueueMangaGroup> = {};

        queue.forEach(job => {
            if (!groups[job.mangaId]) {
                groups[job.mangaId] = {
                    mangaId: job.mangaId,
                    mangaTitle: job.mangaTitle,
                    mangaCover: job.mangaCover,
                    jobs: [],
                };
            }
            groups[job.mangaId].jobs.push(job);
        });

        return Object.values(groups);
    }, [queue]);

    const handleClearAll = () => {
        showDialog(
            t('downloadManager.clearAllTitle') || 'Clear All Downloads',
            t('downloadManager.clearAllMessage') || 'Are you sure you want to clear all downloads?',
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        for (const chapter of downloads) {
                            await deleteDownload(chapter.chapterId);
                        }
                    }
                },
            ]
        );
    };

    const handleCancelAll = () => {
        showDialog(
            t('downloadManager.cancelAllTitle') || 'Cancel All Downloads',
            t('downloadManager.cancelAllMessage') || 'Are you sure you want to cancel all queued downloads?',
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.ok') || 'OK',
                    style: 'destructive',
                    onPress: () => {
                        queue.forEach(job => cancelDownload(job.chapterId));
                    }
                },
            ]
        );
    };

    const handleDeleteChapter = (chapterId: string, chapterTitle: string) => {
        showDialog(
            t('downloadManager.deleteChapterTitle') || 'Delete Download',
            (t('downloadManager.deleteChapterMessage') || 'Delete {{chapter}}?').replace('{{chapter}}', chapterTitle),
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: () => deleteDownload(chapterId)
                },
            ]
        );
    };

    const handleDeleteManga = (mangaTitle: string, chapters: DownloadedChapter[]) => {
        showDialog(
            t('downloadManager.deleteMangaTitle') || 'Delete All Downloads',
            (t('downloadManager.deleteMangaMessage') || 'Delete all {{count}} downloaded chapters from {{manga}}?')
                .replace('{{count}}', chapters.length.toString())
                .replace('{{manga}}', mangaTitle),
            [
                { text: t('common.cancel') || 'Cancel', style: 'cancel' },
                {
                    text: t('common.delete') || 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        for (const chapter of chapters) {
                            await deleteDownload(chapter.chapterId);
                        }
                    }
                },
            ]
        );
    };

    const handleOpenReader = (chapter: DownloadedChapter) => {
        navigation.navigate('Reader', {
            mangaId: chapter.mangaId,
            chapterId: chapter.chapterId,
            sourceId: chapter.sourceId,
        });
    };

    const handleOpenManga = (group: MangaGroup) => {
        if (group.sourceId) {
            navigation.navigate('MangaDetail', {
                mangaId: group.mangaId,
                sourceId: group.sourceId,
            });
        }
    };

    const menuOptions = [
        ...(queue.length > 0 ? [
            isPaused
                ? { label: t('downloadManager.resumeAll') || 'Resume all', value: 'resumeAll' }
                : { label: t('downloadManager.pauseAll') || 'Pause all', value: 'pauseAll' },
            { label: t('downloadManager.cancelAll') || 'Cancel all', value: 'cancelAll' },
        ] : []),
        ...(downloads.length > 0 ? [
            { label: t('downloadManager.clearAll') || 'Clear all downloads', value: 'clearAll' },
        ] : []),
    ];

    const handleMenuSelect = (value: string) => {
        switch (value) {
            case 'clearAll':
                handleClearAll();
                break;
            case 'cancelAll':
                handleCancelAll();
                break;
            case 'pauseAll':
                pauseAll();
                break;
            case 'resumeAll':
                resumeAll();
                break;
        }
    };

    const hasDownloads = downloads.length > 0 || queue.length > 0;
    const totalSize = downloads.reduce((acc, ch) => acc + ch.size, 0);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="chevron-back" size={28} color={theme.text} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>
                        {t('downloadManager.title')}
                    </Text>
                    {menuOptions.length > 0 ? (
                        <NativeDropdown
                            options={menuOptions}
                            selectedValue=""
                            onSelect={handleMenuSelect}
                            title={t('downloadManager.options') || 'Options'}
                        >
                            <View style={styles.menuButton}>
                                <Ionicons name="ellipsis-vertical" size={24} color={theme.text} />
                            </View>
                        </NativeDropdown>
                    ) : (
                        <View style={styles.menuButton} />
                    )}
                </View>

                {/* Content */}
                <ScrollView contentContainerStyle={styles.content}>
                    {/* Active Downloads Queue */}
                    {queue.length > 0 && (
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                                    {isPaused
                                        ? (t('downloadManager.paused') || 'Paused')
                                        : (t('downloadManager.activeDownloads') || 'Active Downloads')
                                    } ({queue.length})
                                </Text>
                                <TouchableOpacity
                                    style={[styles.pauseButton, { backgroundColor: theme.card }]}
                                    onPress={isPaused ? resumeAll : pauseAll}
                                >
                                    <Ionicons
                                        name={isPaused ? "play" : "pause"}
                                        size={18}
                                        color={theme.primary}
                                    />
                                </TouchableOpacity>
                            </View>

                            {queueGroups.map(group => (
                                <View
                                    key={group.mangaId}
                                    style={[styles.queueGroup, { backgroundColor: theme.card }]}
                                >
                                    {/* Manga Header */}
                                    <View style={styles.queueMangaHeader}>
                                        <Image
                                            source={{ uri: group.mangaCover }}
                                            style={styles.queueCover}
                                        />
                                        <View style={styles.queueMangaInfo}>
                                            <Text style={[styles.queueMangaTitle, { color: theme.text }]} numberOfLines={1}>
                                                {group.mangaTitle}
                                            </Text>
                                            <Text style={[styles.queueMangaMeta, { color: theme.textSecondary }]}>
                                                {group.jobs.length} {t('downloadManager.chaptersQueued') || 'chapters queued'}
                                            </Text>
                                        </View>
                                    </View>

                                    {/* Queue Items */}
                                    {group.jobs.map((job, idx) => {
                                        const progress = job.total > 0 ? job.progress / job.total : 0;
                                        const isActive = job.status === 'downloading';

                                        return (
                                            <View
                                                key={job.chapterId}
                                                style={[
                                                    styles.queueItem,
                                                    idx < group.jobs.length - 1 && {
                                                        borderBottomWidth: StyleSheet.hairlineWidth,
                                                        borderBottomColor: theme.border
                                                    }
                                                ]}
                                            >
                                                <View style={styles.queueItemInfo}>
                                                    <View style={styles.queueItemHeader}>
                                                        <Text style={[styles.queueChapterTitle, { color: theme.text }]} numberOfLines={1}>
                                                            {job.chapterTitle}
                                                        </Text>
                                                        <TouchableOpacity
                                                            style={styles.cancelButton}
                                                            onPress={() => cancelDownload(job.chapterId)}
                                                        >
                                                            <Ionicons name="close" size={18} color={theme.textSecondary} />
                                                        </TouchableOpacity>
                                                    </View>

                                                    <View style={styles.queueItemProgress}>
                                                        <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
                                                            <View
                                                                style={[
                                                                    styles.progressBarFill,
                                                                    {
                                                                        backgroundColor: isActive ? theme.primary : theme.textSecondary,
                                                                        width: `${progress * 100}%`
                                                                    }
                                                                ]}
                                                            />
                                                        </View>
                                                        <Text style={[styles.queueProgress, { color: theme.textSecondary }]}>
                                                            {isActive
                                                                ? `${job.progress}/${job.total}`
                                                                : job.status === 'paused'
                                                                    ? (t('downloadManager.paused') || 'Paused')
                                                                    : (t('downloadManager.queued') || 'Queued')
                                                            }
                                                        </Text>
                                                    </View>
                                                </View>
                                            </View>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Downloaded Content */}
                    {downloads.length > 0 ? (
                        <View style={styles.section}>
                            <View style={styles.sectionHeader}>
                                <Text style={[styles.sectionTitle, { color: theme.text }]}>
                                    {t('downloadManager.downloaded') || 'Downloaded'} ({downloads.length})
                                </Text>
                                <Text style={[styles.totalSize, { color: theme.textSecondary }]}>
                                    {formatFileSize(totalSize)}
                                </Text>
                            </View>

                            {mangaGroups.map(group => (
                                <View key={group.mangaId} style={[styles.mangaGroup, { backgroundColor: theme.card }]}>
                                    {/* Manga Header */}
                                    <TouchableOpacity
                                        style={styles.mangaHeader}
                                        onPress={() => handleOpenManga(group)}
                                        activeOpacity={0.7}
                                    >
                                        <Image
                                            source={{ uri: group.mangaCover }}
                                            style={styles.mangaCover}
                                        />
                                        <View style={styles.mangaInfo}>
                                            <Text style={[styles.mangaTitle, { color: theme.text }]} numberOfLines={2}>
                                                {group.mangaTitle}
                                            </Text>
                                            <Text style={[styles.mangaMeta, { color: theme.textSecondary }]}>
                                                {group.chapters.length} {t('downloadManager.chaptersDownloaded') || 'chapters'} • {formatFileSize(group.totalSize)}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.deleteButton}
                                            onPress={() => handleDeleteManga(group.mangaTitle, group.chapters)}
                                        >
                                            <Ionicons name="trash-outline" size={20} color={theme.error} />
                                        </TouchableOpacity>
                                    </TouchableOpacity>

                                    {/* Chapters */}
                                    {group.chapters.map((chapter, idx) => (
                                        <TouchableOpacity
                                            key={chapter.chapterId}
                                            style={[
                                                styles.chapterItem,
                                                idx < group.chapters.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
                                            ]}
                                            onPress={() => handleOpenReader(chapter)}
                                            activeOpacity={0.7}
                                        >
                                            <View style={styles.chapterInfo}>
                                                <Text style={[styles.chapterTitle, { color: theme.text }]} numberOfLines={1}>
                                                    {chapter.chapterTitle}
                                                </Text>
                                                <Text style={[styles.chapterMeta, { color: theme.textSecondary }]}>
                                                    {chapter.pages.length} {t('downloadManager.pages') || 'pages'} • {formatFileSize(chapter.size)} • {formatDate(chapter.downloadedAt)}
                                                </Text>
                                            </View>
                                            <View style={styles.chapterActions}>
                                                <Ionicons name="book-outline" size={18} color={theme.primary} style={{ marginRight: 12 }} />
                                                <TouchableOpacity
                                                    style={styles.chapterDeleteButton}
                                                    onPress={() => handleDeleteChapter(chapter.chapterId, chapter.chapterTitle)}
                                                >
                                                    <Ionicons name="close-circle" size={22} color={theme.textSecondary} />
                                                </TouchableOpacity>
                                            </View>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            ))}
                        </View>
                    ) : queue.length === 0 ? (
                        <View style={[styles.emptyContainer, { backgroundColor: theme.card }]}>
                            <Ionicons name="download-outline" size={64} color={theme.textSecondary} />
                            <Text style={[styles.emptyTitle, { color: theme.text }]}>
                                {t('downloadManager.noDownloads') || 'No Downloads'}
                            </Text>
                            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                                {t('downloadManager.emptyMessage')}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>
            </SafeAreaView>

            {/* Material You Dialog for Android */}
            <AppDialog
                visible={dialogVisible}
                title={dialogConfig.title}
                message={dialogConfig.message}
                buttons={dialogConfig.buttons}
                onDismiss={hideDialog}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    safeArea: {
        flex: 1,
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '600',
        flex: 1,
        textAlign: 'center',
    },
    menuButton: {
        padding: 8,
        width: 44,
    },
    content: {
        flexGrow: 1,
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    totalSize: {
        fontSize: 14,
    },
    pauseButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Queue styles
    queueGroup: {
        borderRadius: 12,
        marginBottom: 12,
        overflow: 'hidden',
    },
    queueMangaHeader: {
        flexDirection: 'row',
        padding: 12,
        alignItems: 'center',
    },
    queueCover: {
        width: 40,
        height: 56,
        borderRadius: 4,
    },
    queueMangaInfo: {
        flex: 1,
        marginLeft: 12,
    },
    queueMangaTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 2,
    },
    queueMangaMeta: {
        fontSize: 12,
    },
    queueItem: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginLeft: 52,
    },
    queueItemInfo: {
        flex: 1,
    },
    queueItemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    queueChapterTitle: {
        fontSize: 13,
        flex: 1,
        marginRight: 8,
    },
    cancelButton: {
        padding: 4,
    },
    queueItemProgress: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    progressBarBg: {
        flex: 1,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        marginRight: 8,
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 2,
    },
    queueProgress: {
        fontSize: 11,
        minWidth: 50,
    },

    // Downloaded manga styles
    mangaGroup: {
        borderRadius: 12,
        marginBottom: 12,
        overflow: 'hidden',
    },
    mangaHeader: {
        flexDirection: 'row',
        padding: 12,
        alignItems: 'center',
    },
    mangaCover: {
        width: 48,
        height: 68,
        borderRadius: 6,
    },
    mangaInfo: {
        flex: 1,
        marginLeft: 12,
    },
    mangaTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 4,
    },
    mangaMeta: {
        fontSize: 12,
    },
    deleteButton: {
        padding: 8,
    },
    chapterItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginLeft: 60,
    },
    chapterInfo: {
        flex: 1,
    },
    chapterTitle: {
        fontSize: 14,
        marginBottom: 2,
    },
    chapterMeta: {
        fontSize: 11,
    },
    chapterActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    chapterDeleteButton: {
        padding: 4,
    },
    emptyContainer: {
        flex: 1,
        borderRadius: 12,
        padding: 32,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 300,
        gap: 12,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginTop: 16,
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});
