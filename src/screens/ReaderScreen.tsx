import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Dimensions,
  FlatList,
  TouchableOpacity,
  StatusBar,
  Animated,
  Platform,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ActivityIndicator,
  Modal,
  ScrollView,
  useWindowDimensions,
  AppState,
  AppStateStatus,
  Alert,
  GestureResponderEvent,
} from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Sharing from 'expo-sharing';
import { Paths, File } from 'expo-file-system';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadContext';
import { getCookies as getNativeCookies, launchBypassActivity } from 'cloudflare-bypass';
import { getCookiesForUrl, getGlobalUserAgent, setCookiesForDomain } from '../services/cookieStore';
import {
  getChapterPages,
  getMangaDetails,
  getChapters,
  decryptDrmImage,
  getMangaShareUrl,
  getCloudflareBypassRequest,
  fetchImageThroughExtension,
} from '../services/sourceService';
import { cacheChapterPages } from '../services/cacheService';
import {
  ReaderSettingsValues,
  defaultReaderSettings,
  getReaderSettings,
  saveReaderSettings,
  resetMangaReaderSettings,
  applySettingsGlobally,
  ReaderMode,
  ReaderDirection,
  PagedDisplayMode,
} from '../services/readerSettingsService';
import { Manga, Chapter, Page, RootStackParamList } from '../types';
import { t } from '../services/i18nService';
import { SpotifyMiniPlayer } from '../components/SpotifyMiniPlayer';
import { ReaderSettingsModal } from '../components/ReaderSettingsModal';

type ReaderRouteProp = RouteProp<RootStackParamList, 'Reader'>;
type ReaderNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Parse DRM URL to get extensionId and actual URL
const parseDrmUrl = (url: string): { extensionId: string; actualUrl: string } | null => {
  if (!url || !url.startsWith('drm://')) return null;
  const withoutScheme = url.substring(6);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) return null;
  return {
    extensionId: withoutScheme.substring(0, slashIndex),
    actualUrl: withoutScheme.substring(slashIndex + 1),
  };
};

// Shared aspect ratio cache across pages & mounts (URL -> height/width aspect ratio)
const pageDimensionsCache = new Map<string, number>();

export interface PreloadedPage extends Page {
  resolvedUrl: string;
  preloaded: boolean;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  retryKey?: number;
  aspectRatio?: number;
}

// Page group for double-page spreads
export interface PageGroup {
  id: string;
  groupIndex: number;
  pages: PreloadedPage[];
  isDouble: boolean;
  startPageNumber: number;
  endPageNumber: number;
}

const getImageRequestHeaders = (uri: string): Record<string, string> | undefined => {
  try {
    const urlObj = new URL(uri);
    const hostname = urlObj.hostname.toLowerCase();
    const headers: Record<string, string> = {};

    if (hostname === 'db.yurigarden.com' || hostname === 'cdn.yurigarden.moe') {
      headers['referer'] = 'https://yurigarden.moe/';
      headers['origin'] = 'https://yurigarden.moe';
    } else if (hostname.includes('mangadex')) {
      headers['referer'] = 'https://mangadex.org/';
    }

    const cookies = getCookiesForUrl(uri);
    if (cookies) {
      headers['Cookie'] = cookies;
    }

    const ua = getGlobalUserAgent();
    if (ua) {
      headers['User-Agent'] = ua;
    }

    return Object.keys(headers).length > 0 ? headers : undefined;
  } catch {
    return undefined;
  }
};

// Preload a single page with optional source extension fallback
const preloadSinglePage = async (page: Page, sourceId?: string): Promise<PreloadedPage> => {
  const drmInfo = parseDrmUrl(page.imageUrl);

  if (drmInfo) {
    try {
      const decryptedUrl = await decryptDrmImage(drmInfo.extensionId, drmInfo.actualUrl);
      if (decryptedUrl) {
        await Image.prefetch(decryptedUrl);
        return { ...page, resolvedUrl: decryptedUrl, preloaded: true, loading: false, error: false };
      }
    } catch (e) {
      console.warn('[Reader] Failed to decrypt page', page.pageNumber, e);
      return { ...page, resolvedUrl: page.imageUrl, preloaded: false, loading: false, error: true, errorMessage: 'DRM Decryption Failed' };
    }
    return { ...page, resolvedUrl: page.imageUrl, preloaded: false, loading: false, error: true };
  } else {
    try {
      const headers = getImageRequestHeaders(page.imageUrl);
      if (!headers) {
        const p = Image.prefetch(page.imageUrl);
        if (p && typeof (p as any).catch === 'function') {
          await p.catch(() => {});
        }
      }
      return { ...page, resolvedUrl: page.imageUrl, preloaded: true, loading: false, error: false };
    } catch {
      if (sourceId) {
        try {
          const extImage = await fetchImageThroughExtension(sourceId, page.imageUrl);
          if (extImage) {
            return { ...page, resolvedUrl: extImage, preloaded: true, loading: false, error: false };
          }
        } catch {}
      }
      return { ...page, resolvedUrl: page.imageUrl, preloaded: true, loading: false, error: false };
    }
  }
};

// Preload all pages with batch progress callback
const preloadAllPagesWithProgress = async (
  pages: Page[],
  onProgress: (loaded: number, total: number) => void,
  onPageLoaded: (index: number, page: PreloadedPage) => void
): Promise<PreloadedPage[]> => {
  const results: PreloadedPage[] = new Array(pages.length);
  let loaded = 0;
  const BATCH_SIZE = 3;

  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = pages.slice(i, Math.min(i + BATCH_SIZE, pages.length));
    await Promise.all(
      batch.map(async (page, batchIndex) => {
        const result = await preloadSinglePage(page);
        const index = i + batchIndex;
        results[index] = result;
        loaded++;
        onProgress(loaded, pages.length);
        onPageLoaded(index, result);
      })
    );
  }

  return results;
};

// Paperback Info Modal Component
const InfoModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  manga: Manga | null;
  chapter: Chapter | null;
  currentPage: number;
  totalPages: number;
  onContinueReading: () => void;
  onSearchTag: (tag: string) => void;
}> = ({ visible, onClose, manga, chapter, currentPage, totalPages, onContinueReading, onSearchTag }) => {
  const [showFullDescription, setShowFullDescription] = useState(false);
  const { theme } = useTheme();

  if (!manga || !chapter) return null;

  const handleContinue = () => {
    onClose();
    onContinueReading();
  };

  const handleTagPress = (tag: string) => {
    onClose();
    onSearchTag(tag);
  };

  const getStatusColor = () => {
    if (manga.status === 'completed') return theme.success;
    return theme.primary;
  };

  const getStatusText = () => {
    const status = manga?.status?.toLowerCase();
    if (status && ['ongoing', 'completed', 'hiatus', 'unknown'].includes(status)) {
      return t(`manga.${status}`).toUpperCase();
    }
    return t('manga.unknown').toUpperCase();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.infoModalContainer}>
        <TouchableOpacity style={styles.infoModalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.infoModalContent}>
          <TouchableOpacity style={styles.infoModalClose} onPress={onClose}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>

          <ScrollView style={styles.infoModalScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.infoModalHeader}>
              <Image source={{ uri: manga.coverImage }} style={styles.infoModalCover} resizeMode="cover" />
              <View style={styles.infoModalHeaderInfo}>
                <Text style={styles.infoModalTitle} numberOfLines={3}>{manga.title}</Text>
                <Text style={styles.infoModalAuthor}>{manga.author || 'Unknown'}</Text>
                <View style={[styles.infoModalStatusBadge, { backgroundColor: getStatusColor() }]}>
                  <Text style={styles.infoModalStatusBadgeText}>{getStatusText()}</Text>
                </View>
              </View>
            </View>

            <View style={styles.infoModalButtons}>
              <TouchableOpacity style={styles.infoModalReadButton} onPress={handleContinue}>
                <Ionicons name="book" size={18} color="#000" />
                <Text style={styles.infoModalReadButtonText}>
                  {t('reader.chapter')} {chapter.number} • {currentPage + 1}/{totalPages}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.infoModalIconButton}>
                <Ionicons name="bookmark-outline" size={24} color="#FA6432" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.infoModalIconButton}>
                <Ionicons name="share-outline" size={24} color="#FA6432" />
              </TouchableOpacity>
            </View>

            {manga.description ? (
              <View style={styles.infoModalDescSection}>
                <TouchableOpacity onPress={() => setShowFullDescription(!showFullDescription)} activeOpacity={0.7}>
                  <Text style={styles.infoModalDescription} numberOfLines={showFullDescription ? undefined : 4}>
                    {manga.description}
                  </Text>
                  <Text style={styles.infoModalMoreButton}>
                    {showFullDescription ? t('manga.showLess') : t('manga.showMore')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {manga.genres && manga.genres.length > 0 ? (
              <View style={styles.infoModalTagsSection}>
                <View style={styles.infoModalTagsLabelContainer}>
                  <Text style={styles.infoModalTagsLabel}>{t('reader.tags')}</Text>
                </View>
                <View style={styles.infoModalGenres}>
                  {manga.genres.map((genre, index) => (
                    <TouchableOpacity key={index} style={styles.infoModalGenreTag} onPress={() => handleTagPress(genre)}>
                      <Ionicons name="search" size={12} color="#888" style={{ marginRight: 4 }} />
                      <Text style={styles.infoModalGenreText}>{genre}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

// Single Image Element with Loading State, Error State, and Direct Retry
const PageImageElementComponent: React.FC<{
  page: PreloadedPage;
  targetWidth: number;
  targetHeight: number;
  onPress: (e: GestureResponderEvent) => void;
  onLongPress: () => void;
  onRetry: () => void;
  totalPages: number;
  fitMode?: 'contain' | 'cover';
  isVertical?: boolean;
  downsamplePages?: boolean;
}> = ({
  page,
  targetWidth,
  targetHeight,
  onPress,
  onLongPress,
  onRetry,
  totalPages,
  fitMode = 'contain',
  isVertical = false,
  downsamplePages = true,
}) => {
  const url = page.resolvedUrl || page.imageUrl;
  const cachedAspect = page.aspectRatio || (url ? pageDimensionsCache.get(url) : undefined);
  // Default aspect ratio for standard manga is ~1.42 (B6 tankobon)
  const initialHeight = isVertical
    ? (cachedAspect ? Math.round(targetWidth * cachedAspect) : Math.round(targetWidth * 1.42))
    : targetHeight;

  const [imgHeight, setImgHeight] = useState(initialHeight);
  const [loadError, setLoadError] = useState(page.error || false);
  const [internalLoading, setInternalLoading] = useState(page.loading ?? false);
  const requestHeaders = useMemo(() => getImageRequestHeaders(page.resolvedUrl), [page.resolvedUrl]);

  // Use refs for stable event handlers to avoid re-renders when parent recreation happens
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    if (page.error) {
      setLoadError(true);
      setInternalLoading(false);
      return;
    }
    setLoadError(false);

    if (page.preloaded && page.resolvedUrl) {
      if (!isVertical) {
        setImgHeight(targetHeight);
        setInternalLoading(false);
      } else {
        const existing = pageDimensionsCache.get(page.resolvedUrl) || page.aspectRatio;
        if (existing) {
          setImgHeight(Math.round(targetWidth * existing));
          setInternalLoading(false);
          return;
        }
        Image.getSize(
          page.resolvedUrl,
          (w, h) => {
            if (w > 0 && h > 0) {
              const aspect = h / w;
              pageDimensionsCache.set(page.resolvedUrl, aspect);
              page.aspectRatio = aspect;
              setImgHeight(Math.round(targetWidth * aspect));
            }
            setInternalLoading(false);
          },
          () => {
            setInternalLoading(false);
          }
        );
      }
    }
  }, [page.resolvedUrl, page.preloaded, page.error, page.retryKey, targetWidth, targetHeight, isVertical]);

  if (page.loading || internalLoading) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={(e) => onPressRef.current(e)}
        style={[styles.pagePlaceholder, { width: targetWidth, height: isVertical ? imgHeight : targetHeight }]}
      >
        <ActivityIndicator size="large" color="#FA6432" />
        <Text style={styles.pagePlaceholderText}>
          {t('reader.loadingPage', { page: page.pageNumber, total: totalPages })}
        </Text>
      </TouchableOpacity>
    );
  }

  if (loadError || page.error) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={(e) => onPressRef.current(e)}
        style={[styles.pagePlaceholder, { width: targetWidth, height: isVertical ? imgHeight : targetHeight }]}
      >
        <Ionicons name="image-outline" size={48} color="#555" />
        <Text style={styles.pageErrorText}>{t('reader.failedToLoadPage', { page: page.pageNumber })}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => onRetryRef.current()} activeOpacity={0.7}>
          <Ionicons name="refresh" size={16} color="#fff" />
          <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  const imageSource = requestHeaders ? { uri: page.resolvedUrl, headers: requestHeaders } : { uri: page.resolvedUrl };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={(e) => onPressRef.current(e)}
      onLongPress={() => onLongPressRef.current()}
      delayLongPress={450}
    >
      <Image
        key={`page-img-${page.pageNumber}-${page.retryKey || 0}`}
        source={imageSource}
        style={{ width: targetWidth, height: isVertical ? imgHeight : targetHeight }}
        resizeMode={fitMode}
        resizeMethod={downsamplePages ? 'resize' : 'scale'}
        onError={() => {
          console.warn('[Reader] Error rendering page:', page.pageNumber);
          setLoadError(true);
        }}
      />
    </TouchableOpacity>
  );
};

const PageImageElement = React.memo(PageImageElementComponent, (prev, next) => {
  return (
    prev.page.id === next.page.id &&
    prev.page.resolvedUrl === next.page.resolvedUrl &&
    prev.page.preloaded === next.page.preloaded &&
    prev.page.loading === next.page.loading &&
    prev.page.error === next.page.error &&
    prev.page.retryKey === next.page.retryKey &&
    prev.targetWidth === next.targetWidth &&
    prev.targetHeight === next.targetHeight &&
    prev.isVertical === next.isVertical &&
    prev.fitMode === next.fitMode &&
    prev.downsamplePages === next.downsamplePages &&
    prev.totalPages === next.totalPages
  );
});

// Chapter Transition Component
const ChapterTransition: React.FC<{
  type: 'previous' | 'next';
  chapter: Chapter | null;
  manga: Manga | null;
  isLoading: boolean;
  onNavigate: () => void;
}> = ({ type, chapter, isLoading, onNavigate }) => {
  const isPrevious = type === 'previous';
  const topPadding = isPrevious ? (Platform.OS === 'ios' ? 70 : (StatusBar.currentHeight || 36) + 30) : 20;
  const bottomPadding = !isPrevious ? (Platform.OS === 'ios' ? 100 : 90) : 20;

  if (!chapter) {
    return (
      <View style={[styles.transitionContainer, { paddingTop: topPadding, paddingBottom: bottomPadding }]}>
        <View style={styles.transitionContent}>
          <View style={styles.transitionBadge}>
            <Ionicons
              name={isPrevious ? 'flag-outline' : 'checkmark-done-circle-outline'}
              size={16}
              color="#888"
              style={{ marginRight: 6 }}
            />
            <Text style={styles.transitionLabel}>
              {isPrevious ? t('reader.noPreviousChapter') : t('reader.noNextChapter')}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.transitionContainer, { paddingTop: topPadding, paddingBottom: bottomPadding }]}>
      <View style={styles.transitionContent}>
        <Text style={styles.transitionLabel}>
          {isPrevious ? t('reader.previousChapter') : t('reader.nextChapter')}
        </Text>
        <Text style={styles.transitionChapterTitle}>
          Ch. {chapter.number}{chapter.title ? ` - ${chapter.title}` : ''}
        </Text>
        <TouchableOpacity style={styles.transitionButton} onPress={onNavigate} disabled={isLoading} activeOpacity={0.8}>
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.transitionButtonText}>
              {isPrevious ? t('reader.goToPrevious') : t('reader.nextChapter')}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const ReaderScreen: React.FC = () => {
  const route = useRoute<ReaderRouteProp>();
  const navigation = useNavigation<ReaderNavigationProp>();
  const { theme } = useTheme();
  const { library, updateProgress } = useLibrary();
  const { downloads } = useDownloads();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;

  const { mangaId, chapterId, sourceId, initialPage } = route.params;

  // Manga & Chapter Data
  const [manga, setManga] = useState<Manga | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pages, setPages] = useState<PreloadedPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chapterLoadError, setChapterLoadError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  // Paperback Reader Settings State
  const [readerSettings, setReaderSettings] = useState<ReaderSettingsValues>(defaultReaderSettings);
  const [isCustomSetting, setIsCustomSetting] = useState(false);
  const isModeSwitchingRef = useRef(false);
  const prevReaderModeRef = useRef<ReaderMode>(defaultReaderSettings.readerMode);

  // HUD Controls state
  const [showControls, setShowControls] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [spotifyPickerOpen, setSpotifyPickerOpen] = useState(false);
  const [orientationLocked, setOrientationLocked] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const flatListRef = useRef<FlatList>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasScrolledToInitialPage = useRef(false);

  // Load Reader Settings for Manga
  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      const { settings, isCustom } = await getReaderSettings(mangaId);
      if (isMounted) {
        setReaderSettings(settings);
        setIsCustomSetting(isCustom);
        setOrientationLocked(settings.rotationLocked);
        prevReaderModeRef.current = settings.readerMode;
      }
    };
    loadSettings();
    return () => {
      isMounted = false;
    };
  }, [mangaId]);

  // Save / Update Setting
  const handleUpdateSetting = useCallback(
    async <K extends keyof ReaderSettingsValues>(key: K, value: ReaderSettingsValues[K]) => {
      if (key === 'readerMode') {
        isModeSwitchingRef.current = true;
      }
      const updated = { ...readerSettings, [key]: value };
      setReaderSettings(updated);
      setIsCustomSetting(true);
      await saveReaderSettings(updated, mangaId);
    },
    [readerSettings, mangaId]
  );

  // Apply Globally
  const handleApplyGlobally = useCallback(async () => {
    await applySettingsGlobally(readerSettings, mangaId);
    setIsCustomSetting(false);
    Alert.alert(t('common.success'), 'Settings applied globally for all titles.');
  }, [readerSettings, mangaId]);

  // Reset to Global Defaults
  const handleResetToGlobal = useCallback(async () => {
    await resetMangaReaderSettings(mangaId);
    const { settings } = await getReaderSettings();
    setReaderSettings(settings);
    setIsCustomSetting(false);
    setOrientationLocked(settings.rotationLocked);
    prevReaderModeRef.current = settings.readerMode;
  }, [mangaId]);

  // Orientation Lock Toggle (HUD rotationLockButtonview)
  const toggleOrientationLock = useCallback(async () => {
    try {
      if (orientationLocked) {
        await ScreenOrientation.unlockAsync();
        setOrientationLocked(false);
        handleUpdateSetting('rotationLocked', false);
      } else {
        const lockType = isLandscape
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT;
        await ScreenOrientation.lockAsync(lockType);
        setOrientationLocked(true);
        handleUpdateSetting('rotationLocked', true);
      }
    } catch (e) {
      console.warn('[Reader] Failed to toggle orientation lock:', e);
    }
  }, [orientationLocked, isLandscape, handleUpdateSetting]);

  // Quick Reader Mode Toggle (HUD quickModeSwitchButtonview)
  const toggleQuickMode = useCallback(() => {
    const nextMode: ReaderMode = readerSettings.readerMode === 'horizontal' ? 'longStrip' : 'horizontal';
    isModeSwitchingRef.current = true;
    handleUpdateSetting('readerMode', nextMode);
  }, [readerSettings.readerMode, handleUpdateSetting]);

  // Cleanup orientation lock when exiting reader
  useFocusEffect(
    useCallback(() => {
      return () => {
        ScreenOrientation.unlockAsync();
      };
    }, [])
  );

  // Check if manga is in library
  useEffect(() => {
    if (manga) {
      const inLibrary = library.some((item) => item.manga.id === manga.id);
      setIsBookmarked(inLibrary);
    }
  }, [manga, library]);

  // Load Chapter Data
  useEffect(() => {
    loadData();
  }, [mangaId, chapterId]);

  // Open web bypass modal
  const handleOpenWebBypass = useCallback(async () => {
    if (!sourceId) return;
    let targetUrl = '';
    let authCaptureJson = '';
    try {
      const [shareUrl, bypassRequest] = await Promise.all([
        mangaId ? getMangaShareUrl(sourceId, mangaId).catch(() => null) : null,
        getCloudflareBypassRequest(sourceId).catch(() => null),
      ]);
      targetUrl = shareUrl || bypassRequest?.url || '';
      if (bypassRequest?.headers) {
        const found = Object.entries(bypassRequest.headers).find(
          ([k]) => k.toLowerCase() === 'x-paperback-auth-capture'
        );
        authCaptureJson = found ? String(found[1]) : '';
      }
    } catch (e) {
      console.warn('[Reader] Error fetching bypass request:', e);
    }

    if (!targetUrl) return;

    let leftReactActivity = false;
    const subscription = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state !== 'active') {
        leftReactActivity = true;
        return;
      }
      if (!leftReactActivity) return;
      subscription.remove();
      try {
        const cookies = await getNativeCookies(targetUrl);
        if (cookies) {
          setCookiesForDomain(targetUrl, cookies);
        }
      } catch (error) {
        console.warn('[Reader] Failed to sync website cookies:', error);
      }
      await loadData();
    });

    await launchBypassActivity(targetUrl, manga?.title || 'Website Verification', sourceId, String(authCaptureJson));
  }, [sourceId, mangaId, manga?.title]);

  const loadData = async () => {
    try {
      setLoading(true);
      setChapterLoadError(null);

      // 1. Check if chapter is downloaded locally
      const downloadedChapter = downloads.find((d) => d.chapterId === chapterId);
      if (downloadedChapter && downloadedChapter.pages.length > 0) {
        const mangaData: Manga = {
          id: downloadedChapter.mangaId,
          title: downloadedChapter.mangaTitle,
          author: '',
          description: '',
          coverImage: downloadedChapter.mangaCover,
          genres: [],
          status: 'ongoing',
          chapters: [],
          lastUpdated: new Date().toISOString(),
          source: downloadedChapter.sourceId || sourceId || '',
        };
        setManga(mangaData);

        const chapterData: Chapter = {
          id: downloadedChapter.chapterId,
          mangaId: downloadedChapter.mangaId,
          number: downloadedChapter.chapterNumber || 1,
          title: downloadedChapter.chapterTitle,
          pages: [],
          releaseDate: downloadedChapter.downloadedAt,
          isRead: false,
        };
        setChapter(chapterData);

        const preloadedPages: PreloadedPage[] = downloadedChapter.pages.map((filePath, index) => ({
          id: `${chapterId}-page-${index}`,
          chapterId: chapterId,
          pageNumber: index + 1,
          imageUrl: filePath,
          resolvedUrl: filePath,
          preloaded: true,
          loading: false,
          error: false,
        }));

        setPages(preloadedPages);
        setLoading(false);
        return;
      }

      // 2. Load from Extension
      if (sourceId) {
        const [pageUrls, mangaDetails, chaptersData] = await Promise.all([
          getChapterPages(sourceId, mangaId, chapterId),
          getMangaDetails(sourceId, mangaId),
          getChapters(sourceId, mangaId),
        ]);

        if (pageUrls && pageUrls.length > 0) {
          const currentChapter = chaptersData.find((ch) => ch.id === chapterId);
          let genres: string[] = [];
          if (mangaDetails?.tags) {
            mangaDetails.tags.forEach((tagSection: any) => {
              if (tagSection.tags && Array.isArray(tagSection.tags)) {
                tagSection.tags.forEach((tg: any) => {
                  if (tg.label) genres.push(tg.label);
                });
              } else if (tagSection.label) {
                genres.push(tagSection.label);
              }
            });
          }

          const existingManga = library.find((e) => e.manga.id === mangaId)?.manga;
          const mangaData: Manga = {
            id: mangaId,
            title: mangaDetails?.titles?.[0] || existingManga?.title || (mangaId ? `Manga ${mangaId}` : ''),
            author: mangaDetails?.author || existingManga?.author || '',
            description: mangaDetails?.desc || existingManga?.description || '',
            coverImage: mangaDetails?.image || existingManga?.coverImage || '',
            genres: genres.length > 0 ? genres : (existingManga?.genres || []),
            status: mangaDetails?.status?.toLowerCase() || existingManga?.status || 'ongoing',
            chapters: chaptersData.length > 0
              ? chaptersData.map((ch) => ({
                  id: ch.id,
                  mangaId: mangaId,
                  number: ch.chapNum,
                  title: ch.name || `Chapter ${ch.chapNum}`,
                  pages: [],
                  releaseDate: ch.time || new Date().toISOString(),
                  isRead: false,
                }))
              : (existingManga?.chapters || []),
            lastUpdated: new Date().toISOString(),
            source: sourceId,
          };
          setManga(mangaData);

          const chapterData: Chapter = {
            id: chapterId,
            mangaId: mangaId,
            number: currentChapter?.chapNum || 1,
            title: currentChapter?.name || 'Chapter',
            pages: [],
            releaseDate: currentChapter?.time || new Date().toISOString(),
            isRead: false,
          };
          setChapter(chapterData);

          const pageData: Page[] = pageUrls.map((url, index) => ({
            id: `${chapterId}-page-${index}`,
            chapterId: chapterId,
            pageNumber: index + 1,
            imageUrl: url,
          }));

          const skeletonPages: PreloadedPage[] = pageData.map((p) => ({
            ...p,
            resolvedUrl: p.imageUrl,
            preloaded: false,
            loading: true,
            error: false,
          }));

          setPages(skeletonPages);
          setLoading(false);

          // Preload pages progressively in background
          await preloadAllPagesWithProgress(
            pageData,
            () => {},
            (index, loadedPage) => {
              setPages((prev) => {
                const next = [...prev];
                next[index] = loadedPage;
                return next;
              });
            }
          );

          try {
            const cacheTask = cacheChapterPages(
              mangaId,
              chapterId,
              pageData.map((p) => ({ pageNumber: p.pageNumber, imageUrl: p.imageUrl }))
            );
            if (cacheTask && typeof (cacheTask as any).catch === 'function') {
              cacheTask.catch(() => {});
            }
          } catch {}

          // Save initial progress
          const initPageNum = (initialPage || 0) + 1;
          const initPercent = pageData.length > 0 ? Math.round((initPageNum / pageData.length) * 100) : 0;
          try {
            updateProgress(
              {
                mangaId: mangaData.id,
                chapterId: chapterData.id,
                pageNumber: initPageNum,
                totalPages: pageData.length,
                percentage: initPercent,
                lastRead: new Date().toISOString(),
              },
              mangaData
            );
          } catch {}
        } else {
          setChapterLoadError('No pages found');
          setPages([]);
        }
      } else {
        setChapterLoadError('Source not specified');
        setPages([]);
      }
    } catch (error) {
      console.error('[Reader] Failed to load reader data:', error);
      const msg = error instanceof Error ? error.message : 'No pages found';
      setChapterLoadError(msg);
      setPages([]);
    } finally {
      setLoading(false);
    }
  };

  // Retry individual page image
  const retrySinglePage = useCallback(
    async (pageIndex: number) => {
      const pageToRetry = pages[pageIndex];
      if (!pageToRetry) return;

      setPages((prev) => {
        const next = [...prev];
        next[pageIndex] = { ...pageToRetry, loading: true, error: false, retryKey: (pageToRetry.retryKey || 0) + 1 };
        return next;
      });

      let reloaded = await preloadSinglePage(pageToRetry, sourceId);
      if (reloaded.error && sourceId) {
        try {
          const extFetched = await fetchImageThroughExtension(sourceId, pageToRetry.imageUrl);
          if (extFetched) {
            reloaded = { ...pageToRetry, resolvedUrl: extFetched, preloaded: true, loading: false, error: false };
          }
        } catch {}
      }

      setPages((prev) => {
        const next = [...prev];
        next[pageIndex] = { ...reloaded, retryKey: (pageToRetry.retryKey || 0) + 1 };
        return next;
      });
    },
    [pages, sourceId]
  );

  // Long press page -> Save or Share image
  const handlePageLongPress = useCallback(
    async (page: PreloadedPage) => {
      if (!readerSettings.longPressToSaveImageEnabled || !page.resolvedUrl) return;

      Alert.alert(
        `Page ${page.pageNumber}`,
        'Save or share this page',
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: 'Share Page Image',
            onPress: async () => {
              try {
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(page.resolvedUrl);
                } else {
                  Alert.alert('Sharing unavailable', 'Sharing is not supported on this platform.');
                }
              } catch (e) {
                console.warn('[Reader] Share error:', e);
              }
            },
          },
        ]
      );
    },
    [readerSettings.longPressToSaveImageEnabled]
  );

  // Controls Visibility
  const startControlsTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (spotifyPickerOpen || showSettingsModal || showInfoModal) return;
    controlsTimeoutRef.current = setTimeout(() => {
      hideControls();
    }, 5000);
  }, [spotifyPickerOpen, showSettingsModal, showInfoModal]);

  const hideControls = useCallback(() => {
    if (spotifyPickerOpen || showSettingsModal || showInfoModal) return;
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowControls(false));
  }, [spotifyPickerOpen, showSettingsModal, showInfoModal, fadeAnim]);

  useEffect(() => {
    if (showSettingsModal || showInfoModal || spotifyPickerOpen) {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
  }, [showSettingsModal, showInfoModal, spotifyPickerOpen]);

  const showControlsWithTimer = () => {
    setShowControls(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    startControlsTimer();
  };

  const toggleControls = () => {
    if (showControls) {
      hideControls();
    } else {
      showControlsWithTimer();
    }
  };

  // Progress Saving
  const saveProgress = useCallback(
    async (pageNum: number) => {
      if (!manga || !chapter) return;
      const totalPages = pages.length;
      const pageNumber = pageNum + 1;
      const percentage = totalPages > 0 ? Math.round((pageNumber / totalPages) * 100) : 0;

      await updateProgress(
        {
          mangaId: manga.id,
          chapterId: chapter.id,
          pageNumber,
          totalPages,
          percentage,
          lastRead: new Date().toISOString(),
        },
        manga
      );
    },
    [manga, chapter, pages.length, updateProgress]
  );

  // Double-page spread detection
  const isDoublePageMode = useMemo(() => {
    if (readerSettings.readerMode !== 'horizontal') return false;
    if (readerSettings.pagedDisplayMode === 'doublePage') return true;
    if (readerSettings.pagedDisplayMode === 'automatic') return isLandscape;
    return false;
  }, [readerSettings.readerMode, readerSettings.pagedDisplayMode, isLandscape]);

  // Pillarbox calculation based on Paperback orientation setting
  const isPillarboxed = useMemo(() => {
    if (!readerSettings.pillarbox) return false;
    if (readerSettings.pillarboxOrientation === 'both') return true;
    if (readerSettings.pillarboxOrientation === 'landscape') return isLandscape;
    if (readerSettings.pillarboxOrientation === 'portrait') return !isLandscape;
    return false;
  }, [readerSettings.pillarbox, readerSettings.pillarboxOrientation, isLandscape]);

  const pillarboxMargin = useMemo(() => {
    if (!isPillarboxed) return 0;
    return isLandscape ? Math.max(36, Math.round(screenWidth * 0.12)) : 16;
  }, [isPillarboxed, isLandscape, screenWidth]);

  // Build PageGroups for Double-Page Spread
  const pageGroups = useMemo<PageGroup[]>(() => {
    if (!isDoublePageMode || pages.length === 0) {
      return pages.map((p, idx) => ({
        id: `single-group-${p.id}`,
        groupIndex: idx,
        pages: [p],
        isDouble: false,
        startPageNumber: p.pageNumber,
        endPageNumber: p.pageNumber,
      }));
    }

    const groups: PageGroup[] = [];
    let i = 0;

    // Separate first page (Cover page)
    if (readerSettings.markFirstPageAsSingle && pages.length > 0) {
      groups.push({
        id: `cover-${pages[0].id}`,
        groupIndex: 0,
        pages: [pages[0]],
        isDouble: false,
        startPageNumber: pages[0].pageNumber,
        endPageNumber: pages[0].pageNumber,
      });
      i = 1;
    }

    while (i < pages.length) {
      const p1 = pages[i];
      const p2 = i + 1 < pages.length ? pages[i + 1] : null;

      if (p2) {
        groups.push({
          id: `double-${p1.id}-${p2.id}`,
          groupIndex: groups.length,
          pages: [p1, p2],
          isDouble: true,
          startPageNumber: p1.pageNumber,
          endPageNumber: p2.pageNumber,
        });
        i += 2;
      } else {
        groups.push({
          id: `single-${p1.id}`,
          groupIndex: groups.length,
          pages: [p1],
          isDouble: false,
          startPageNumber: p1.pageNumber,
          endPageNumber: p1.pageNumber,
        });
        i += 1;
      }
    }

    return groups;
  }, [pages, isDoublePageMode, readerSettings.markFirstPageAsSingle]);

  // Initial page scrolling
  useEffect(() => {
    if (
      initialPage !== undefined &&
      initialPage > 0 &&
      pages.length > 0 &&
      !loading &&
      flatListRef.current &&
      !hasScrolledToInitialPage.current
    ) {
      const targetPage = Math.min(initialPage, pages.length - 1);
      hasScrolledToInitialPage.current = true;

      setTimeout(() => {
        try {
          if (readerSettings.readerMode === 'horizontal') {
            const targetGroupIndex = pageGroups.findIndex(
              (g) => targetPage + 1 >= g.startPageNumber && targetPage + 1 <= g.endPageNumber
            );
            const scrollIndex = targetGroupIndex !== -1 ? targetGroupIndex : targetPage;
            flatListRef.current?.scrollToOffset({
              offset: scrollIndex * screenWidth,
              animated: false,
            });
          } else {
            flatListRef.current?.scrollToIndex({
              index: targetPage,
              animated: false,
              viewPosition: 0,
            });
          }
          setCurrentPage(targetPage);
        } catch {
          flatListRef.current?.scrollToOffset({
            offset: targetPage * (readerSettings.readerMode === 'horizontal' ? screenWidth : screenHeight),
            animated: false,
          });
          setCurrentPage(targetPage);
        }
      }, 300);
    }
  }, [pages.length, loading, initialPage, readerSettings.readerMode, pageGroups, screenWidth, screenHeight]);

  // Adjacent Chapters
  const getAdjacentChapters = useCallback(() => {
    if (!manga || !chapter) return { previous: null, next: null };
    const sorted = [...manga.chapters].sort((a, b) => {
      const diff = (a.number || 0) - (b.number || 0);
      if (diff !== 0) return diff;
      return new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime();
    });

    const currentIndex = sorted.findIndex((ch) => ch.id === chapter.id);
    if (currentIndex === -1) return { previous: null, next: null };
    return {
      previous: currentIndex > 0 ? sorted[currentIndex - 1] : null,
      next: currentIndex < sorted.length - 1 ? sorted[currentIndex + 1] : null,
    };
  }, [manga, chapter]);

  const { previous: previousChapter, next: nextChapter } = getAdjacentChapters();

  const goToPreviousChapter = () => {
    if (!previousChapter || !manga || isTransitioning) return;
    setIsTransitioning(true);
    navigation.replace('Reader', { mangaId: manga.id, chapterId: previousChapter.id, sourceId });
  };

  const goToNextChapter = () => {
    if (!nextChapter || !manga || isTransitioning) return;
    setIsTransitioning(true);
    navigation.replace('Reader', { mangaId: manga.id, chapterId: nextChapter.id, sourceId });
  };

  const [scrubberTrackWidth, setScrubberTrackWidth] = useState(0);

  const getPageIndicatorText = useCallback(() => {
    if (isDoublePageMode) {
      const currentGroup = pageGroups.find(
        (g) => currentPage + 1 >= g.startPageNumber && currentPage + 1 <= g.endPageNumber
      );
      if (currentGroup && currentGroup.isDouble && currentGroup.pages.length === 2) {
        return `${currentGroup.startPageNumber} - ${currentGroup.endPageNumber} / ${pages.length}`;
      }
    }
    return `${currentPage + 1} / ${pages.length}`;
  }, [isDoublePageMode, pageGroups, currentPage, pages.length]);

  // Navigate to specific page with synchronized scrolling
  const goToPage = useCallback(
    (pageIndex: number, animated = true) => {
      const target = Math.max(0, Math.min(pageIndex, pages.length - 1));
      setCurrentPage(target);
      saveProgress(target);

      if (readerSettings.readerMode === 'horizontal') {
        const targetGroupIndex = pageGroups.findIndex(
          (g) => target + 1 >= g.startPageNumber && target + 1 <= g.endPageNumber
        );
        const scrollIndex = targetGroupIndex !== -1 ? targetGroupIndex : target;
        flatListRef.current?.scrollToOffset({
          offset: scrollIndex * screenWidth,
          animated,
        });
      } else {
        flatListRef.current?.scrollToIndex({
          index: target,
          animated,
          viewPosition: 0,
        });
      }
    },
    [pages.length, readerSettings.readerMode, pageGroups, screenWidth, saveProgress]
  );

  const handleScrubberTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (pages.length <= 1 || scrubberTrackWidth <= 0) return;
      const { locationX } = e.nativeEvent;
      const isRtl = readerSettings.readerDirection === 'rightToLeft';
      let ratio = Math.max(0, Math.min(1, locationX / scrubberTrackWidth));
      if (isRtl) ratio = 1 - ratio;
      const targetPage = Math.round(ratio * (pages.length - 1));
      goToPage(targetPage, true);
    },
    [pages.length, scrubberTrackWidth, readerSettings.readerDirection, goToPage]
  );

  // Auto re-align scroll position when screen rotates, dimensions change, or reader mode switches
  useEffect(() => {
    if (pages.length === 0 || !flatListRef.current) return;
    const isModeChanged = prevReaderModeRef.current !== readerSettings.readerMode;
    if (isModeChanged) {
      prevReaderModeRef.current = readerSettings.readerMode;
      isModeSwitchingRef.current = true;
    }

    const timer = setTimeout(() => {
      if (!flatListRef.current || pages.length === 0) {
        isModeSwitchingRef.current = false;
        return;
      }
      try {
        const target = Math.max(0, Math.min(currentPage, pages.length - 1));
        if (readerSettings.readerMode === 'horizontal') {
          const targetGroupIndex = pageGroups.findIndex(
            (g) => target + 1 >= g.startPageNumber && target + 1 <= g.endPageNumber
          );
          const scrollIndex = targetGroupIndex !== -1 ? targetGroupIndex : target;
          flatListRef.current.scrollToOffset({
            offset: scrollIndex * screenWidth,
            animated: false,
          });
        } else {
          flatListRef.current.scrollToIndex({
            index: target,
            animated: false,
            viewPosition: 0,
          });
        }
      } catch {
        flatListRef.current?.scrollToOffset({
          offset: currentPage * (readerSettings.readerMode === 'horizontal' ? screenWidth : screenHeight),
          animated: false,
        });
      } finally {
        setTimeout(() => {
          isModeSwitchingRef.current = false;
        }, 300);
      }
    }, isModeChanged ? 100 : 0);

    return () => clearTimeout(timer);
  }, [screenWidth, screenHeight, isLandscape, pageGroups, readerSettings.readerMode, currentPage, pages.length]);

  // Page turns / groups navigation
  const goToNextPage = useCallback(() => {
    if (readerSettings.readerMode === 'horizontal') {
      const currentGroupIndex = pageGroups.findIndex(
        (g) => currentPage + 1 >= g.startPageNumber && currentPage + 1 <= g.endPageNumber
      );
      if (currentGroupIndex !== -1 && currentGroupIndex < pageGroups.length - 1) {
        const nextGroup = pageGroups[currentGroupIndex + 1];
        const nextTargetPage = nextGroup ? nextGroup.startPageNumber - 1 : currentPage + 1;
        setCurrentPage(nextTargetPage);
        saveProgress(nextTargetPage);
        flatListRef.current?.scrollToOffset({
          offset: (currentGroupIndex + 1) * screenWidth,
          animated: true,
        });
      } else if (nextChapter) {
        goToNextChapter();
      }
    } else {
      if (currentPage < pages.length - 1) {
        goToPage(currentPage + 1, true);
      } else if (nextChapter) {
        goToNextChapter();
      }
    }
  }, [readerSettings.readerMode, pageGroups, currentPage, screenWidth, nextChapter, saveProgress, goToPage]);

  const goToPreviousPage = useCallback(() => {
    if (readerSettings.readerMode === 'horizontal') {
      const currentGroupIndex = pageGroups.findIndex(
        (g) => currentPage + 1 >= g.startPageNumber && currentPage + 1 <= g.endPageNumber
      );
      if (currentGroupIndex > 0) {
        const prevGroup = pageGroups[currentGroupIndex - 1];
        const prevTargetPage = prevGroup ? prevGroup.startPageNumber - 1 : currentPage - 1;
        setCurrentPage(prevTargetPage);
        saveProgress(prevTargetPage);
        flatListRef.current?.scrollToOffset({
          offset: (currentGroupIndex - 1) * screenWidth,
          animated: true,
        });
      } else if (previousChapter) {
        goToPreviousChapter();
      }
    } else {
      if (currentPage > 0) {
        goToPage(currentPage - 1, true);
      } else if (previousChapter) {
        goToPreviousChapter();
      }
    }
  }, [readerSettings.readerMode, pageGroups, currentPage, screenWidth, previousChapter, saveProgress, goToPage]);

  const lastTapTimeRef = useRef<number>(0);

  // Tap Zone Handling (Paperback tap zones: outer 25% navigate, center 50% toggle HUD)
  const handleReaderPress = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 250) {
        return;
      }
      lastTapTimeRef.current = now;

      if (!readerSettings.tapSidesToNavgiate) {
        toggleControls();
        return;
      }

      const { pageX } = e.nativeEvent;
      const leftThreshold = screenWidth * 0.25;
      const rightThreshold = screenWidth * 0.75;

      if (pageX < leftThreshold) {
        // Left Zone
        if (readerSettings.readerMode === 'horizontal') {
          if (readerSettings.readerDirection === 'rightToLeft') {
            // RTL Manga: Tapping Left goes forward!
            goToNextPage();
          } else {
            // LTR Comics: Tapping Left goes backward!
            goToPreviousPage();
          }
        } else {
          // Vertical mode: scroll to previous page
          if (currentPage > 0) {
            goToPage(currentPage - 1, true);
          }
        }
      } else if (pageX > rightThreshold) {
        // Right Zone
        if (readerSettings.readerMode === 'horizontal') {
          if (readerSettings.readerDirection === 'rightToLeft') {
            // RTL Manga: Tapping Right goes backward!
            goToPreviousPage();
          } else {
            // LTR Comics: Tapping Right goes forward!
            goToNextPage();
          }
        } else {
          // Vertical mode: scroll to next page
          if (currentPage < pages.length - 1) {
            goToPage(currentPage + 1, true);
          }
        }
      } else {
        // Center Zone: Toggle HUD
        toggleControls();
      }
    },
    [readerSettings.tapSidesToNavgiate, readerSettings.readerMode, readerSettings.readerDirection, screenWidth, currentPage, pages.length, goToNextPage, goToPreviousPage, goToPage]
  );

  // Scroll Viewability & Progress Sync
  const saveProgressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPageRef = useRef<number | null>(null);
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  // Flush pending progress on unmount or before navigating
  useEffect(() => {
    return () => {
      if (saveProgressTimeoutRef.current) {
        clearTimeout(saveProgressTimeoutRef.current);
      }
      if (pendingPageRef.current !== null) {
        saveProgressRef.current(pendingPageRef.current);
      }
    };
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (isModeSwitchingRef.current) return;
    if (viewableItems && viewableItems.length > 0) {
      const item = viewableItems[0]?.item;
      if (item) {
        let newPage = 0;
        if ('startPageNumber' in item) {
          newPage = (item as PageGroup).startPageNumber - 1;
        } else if ('pageNumber' in item) {
          newPage = (item as PreloadedPage).pageNumber - 1;
        }
        setCurrentPage(newPage);
        pendingPageRef.current = newPage;

        if (saveProgressTimeoutRef.current) {
          clearTimeout(saveProgressTimeoutRef.current);
        }
        saveProgressTimeoutRef.current = setTimeout(() => {
          if (pendingPageRef.current !== null) {
            saveProgressRef.current(pendingPageRef.current);
            pendingPageRef.current = null;
          }
        }, 400);
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
    minimumViewTime: 0,
  }).current;

  // Background color mapping
  const readerBgColor = useMemo(() => {
    switch (readerSettings.chapterBackgroundColor) {
      case 'black':
        return '#000000';
      case 'dark':
        return '#1C1C1E';
      case 'light':
        return '#E5E5EA';
      case 'white':
        return '#FFFFFF';
      case 'theme':
        return theme.background;
      default:
        return '#000000';
    }
  }, [readerSettings.chapterBackgroundColor, theme.background]);

  // Item layout for horizontal FlatList to guarantee exact paging geometry on rotation
  const getHorizontalItemLayout = useCallback(
    (_: any, index: number) => ({
      length: screenWidth,
      offset: screenWidth * index,
      index,
    }),
    [screenWidth]
  );

  // Render Horizontal Page Group (Single or Double Page Spread)
  const renderHorizontalPageGroup = useCallback(
    ({ item }: { item: PageGroup }) => {
      const horizontalPadding = readerSettings.pagePadding ? 16 : 0;
      const containerWidth = screenWidth - (pillarboxMargin * 2) - horizontalPadding;

      if (item.isDouble && item.pages.length === 2) {
        const halfWidth = containerWidth / 2;
        const isRtl = readerSettings.readerDirection === 'rightToLeft';
        // In RTL (Manga), the second page is on the LEFT, first page is on the RIGHT
        const leftPage = isRtl ? item.pages[1] : item.pages[0];
        const rightPage = isRtl ? item.pages[0] : item.pages[1];

        return (
          <View style={[styles.pageGroupContainer, { width: screenWidth, height: screenHeight, backgroundColor: readerBgColor }]}>
            <View style={[styles.doublePageRow, { width: containerWidth, height: screenHeight }]}>
              <View style={{ width: halfWidth, height: screenHeight, justifyContent: 'center', alignItems: 'center' }}>
                <PageImageElement
                  page={leftPage}
                  targetWidth={halfWidth}
                  targetHeight={screenHeight}
                  onPress={handleReaderPress}
                  onLongPress={() => handlePageLongPress(leftPage)}
                  onRetry={() => retrySinglePage(leftPage.pageNumber - 1)}
                  totalPages={pages.length}
                  fitMode="contain"
                  isVertical={false}
                  downsamplePages={readerSettings.downsamplePages}
                />
              </View>
              <View style={{ width: halfWidth, height: screenHeight, justifyContent: 'center', alignItems: 'center' }}>
                <PageImageElement
                  page={rightPage}
                  targetWidth={halfWidth}
                  targetHeight={screenHeight}
                  onPress={handleReaderPress}
                  onLongPress={() => handlePageLongPress(rightPage)}
                  onRetry={() => retrySinglePage(rightPage.pageNumber - 1)}
                  totalPages={pages.length}
                  fitMode="contain"
                  isVertical={false}
                  downsamplePages={readerSettings.downsamplePages}
                />
              </View>
            </View>
          </View>
        );
      }

      // Single page in group
      const singlePage = item.pages[0];
      return (
        <View style={[styles.pageGroupContainer, { width: screenWidth, height: screenHeight, backgroundColor: readerBgColor }]}>
          <PageImageElement
            page={singlePage}
            targetWidth={containerWidth}
            targetHeight={screenHeight}
            onPress={handleReaderPress}
            onLongPress={() => handlePageLongPress(singlePage)}
            onRetry={() => retrySinglePage(singlePage.pageNumber - 1)}
            totalPages={pages.length}
            fitMode="contain"
            isVertical={false}
            downsamplePages={readerSettings.downsamplePages}
          />
        </View>
      );
    },
    [
      screenWidth,
      screenHeight,
      pillarboxMargin,
      readerSettings.pagePadding,
      readerSettings.readerDirection,
      readerSettings.downsamplePages,
      readerBgColor,
      pages.length,
      handleReaderPress,
      handlePageLongPress,
      retrySinglePage,
    ]
  );

  // Render Vertical Single Page
  const renderVerticalPage = useCallback(
    ({ item }: { item: PreloadedPage }) => {
      const horizontalPadding = readerSettings.pagePadding ? 16 : 0;
      const targetWidth = screenWidth - (pillarboxMargin * 2) - horizontalPadding;

      return (
        <View
          style={{
            width: screenWidth,
            alignItems: 'center',
            backgroundColor: readerBgColor,
            marginBottom: readerSettings.pagePadding ? 12 : 0,
          }}
        >
          <PageImageElement
            page={item}
            targetWidth={targetWidth}
            targetHeight={screenHeight}
            onPress={handleReaderPress}
            onLongPress={() => handlePageLongPress(item)}
            onRetry={() => retrySinglePage(item.pageNumber - 1)}
            totalPages={pages.length}
            fitMode="contain"
            isVertical={true}
            downsamplePages={readerSettings.downsamplePages}
          />
        </View>
      );
    },
    [
      screenWidth,
      screenHeight,
      pillarboxMargin,
      readerSettings.pagePadding,
      readerSettings.downsamplePages,
      readerBgColor,
      pages.length,
      handleReaderPress,
      handlePageLongPress,
      retrySinglePage,
    ]
  );

  // Loading State
  if (loading && pages.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: readerBgColor, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#FA6432" />
        <Text style={{ color: '#888', marginTop: 16, fontSize: 14 }}>{t('common.loading')}...</Text>
      </View>
    );
  }

  // Error State
  if (pages.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: readerBgColor }]}>
        <TouchableOpacity style={styles.backButtonFloat} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={56} color="#666" />
          <Text style={styles.errorText}>{chapterLoadError || t('reader.failedToLoadPage', { page: 1 })}</Text>
          <View style={styles.errorActionsRow}>
            <TouchableOpacity style={styles.errorActionButton} onPress={loadData} activeOpacity={0.8}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.errorActionButtonText}>{t('common.retry')}</Text>
            </TouchableOpacity>
            {sourceId ? (
              <TouchableOpacity style={styles.errorBypassButton} onPress={handleOpenWebBypass} activeOpacity={0.8}>
                <Ionicons name="globe-outline" size={18} color="#fff" />
                <Text style={styles.errorActionButtonText}>{t('source.verifyWebsite') || 'Verify Website'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const isRtl = readerSettings.readerDirection === 'rightToLeft';

  return (
    <View style={[styles.container, { backgroundColor: readerBgColor }]}>
      <StatusBar hidden={!showControls} barStyle="light-content" />

      {/* Reader FlatList */}
      {readerSettings.readerMode === 'horizontal' ? (
        <FlatList
          ref={flatListRef}
          key={`reader-h-${isLandscape ? 'land' : 'port'}-${isDoublePageMode ? 'double' : 'single'}`}
          data={pageGroups}
          renderItem={renderHorizontalPageGroup}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={getHorizontalItemLayout}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          updateCellsBatchingPeriod={50}
          bounces
          scrollEventThrottle={16}
          extraData={{ screenWidth, screenHeight, isLandscape, isDoublePageMode, isPillarboxed }}
        />
      ) : (
        <FlatList
          ref={flatListRef}
          key={`reader-v-${isLandscape ? 'land' : 'port'}`}
          data={pages}
          renderItem={renderVerticalPage}
          keyExtractor={(item) => item.id}
          horizontal={false}
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          updateCellsBatchingPeriod={50}
          extraData={{ screenWidth, screenHeight, isLandscape, isPillarboxed }}
          ListHeaderComponent={
            <ChapterTransition
              type="previous"
              chapter={previousChapter}
              manga={manga}
              isLoading={isTransitioning}
              onNavigate={goToPreviousChapter}
            />
          }
          ListFooterComponent={
            <ChapterTransition
              type="next"
              chapter={nextChapter}
              manga={manga}
              isLoading={isTransitioning}
              onNavigate={goToNextChapter}
            />
          }
          bounces
          scrollEventThrottle={16}
        />
      )}

      {/* Back button when controls are hidden */}
      {!showControls && (
        <TouchableOpacity style={styles.floatingBackButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Floating page indicator when controls hidden (longStrip / vertical mode only) */}
      {readerSettings.readerMode === 'longStrip' && !showControls && (
        <View style={styles.floatingPageIndicator}>
          <Text style={styles.floatingPageText}>
            {getPageIndicatorText()}
          </Text>
        </View>
      )}

      {/* Paperback HUD Overlay (ChapterRendererOverlayView) */}
      <Animated.View
        style={[styles.topBar, { opacity: fadeAnim }]}
        pointerEvents={showControls ? 'auto' : 'none'}
      >
        <View style={styles.topBarContent}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          {/* Settings Button on Left if settingButtonLocation === 'left' */}
          {readerSettings.settingButtonLocation === 'left' && (
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowSettingsModal(true)}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Ionicons name="settings-outline" size={22} color="#fff" />
            </TouchableOpacity>
          )}

          <View style={styles.titleContainer}>
            <Text style={styles.mangaTitle} numberOfLines={1}>
              {manga?.title}
            </Text>
            <Text style={styles.chapterInfo} numberOfLines={1}>
              Ch. {chapter?.number}{chapter?.title ? ` - ${chapter.title}` : ''}
            </Text>
          </View>

          <View style={styles.topBarActions}>
            {/* Website verification button */}
            {sourceId ? (
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={handleOpenWebBypass}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Ionicons name="globe-outline" size={22} color="#fff" />
              </TouchableOpacity>
            ) : null}

            {/* Quick Mode Switch Button (quickModeSwitchButtonview) */}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={toggleQuickMode}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Ionicons
                name={readerSettings.readerMode === 'horizontal' ? 'book-outline' : 'reorder-four-outline'}
                size={22}
                color="#fff"
              />
            </TouchableOpacity>

            {/* Rotation Lock Button (rotationLockButtonview) */}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={toggleOrientationLock}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Ionicons
                name={orientationLocked ? 'lock-closed' : 'lock-open-outline'}
                size={22}
                color={orientationLocked ? '#FA6432' : '#fff'}
              />
            </TouchableOpacity>

            {/* Info Button (infoButtonview) */}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => setShowInfoModal(true)}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Ionicons name="information-circle-outline" size={24} color="#fff" />
            </TouchableOpacity>

            {/* Settings Button on Right if settingButtonLocation !== 'left' */}
            {readerSettings.settingButtonLocation !== 'left' && (
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={() => setShowSettingsModal(true)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                <Ionicons name="settings-outline" size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>

      {/* Bottom Bar */}
      <Animated.View
        style={[styles.bottomBar, { opacity: fadeAnim }]}
        pointerEvents={showControls ? 'auto' : 'none'}
      >
        {/* Page Slider / Scrubber */}
        <View style={styles.scrubberRow}>
          <TouchableOpacity
            style={styles.scrubberButton}
            onPress={isRtl ? goToNextPage : goToPreviousPage}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>

          <View
            style={styles.scrubberTouchArea}
            onLayout={(e) => setScrubberTrackWidth(e.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleScrubberTouch}
            onResponderMove={handleScrubberTouch}
          >
            <View style={styles.scrubberTrack}>
              <View
                style={[
                  styles.scrubberProgress,
                  {
                    width: `${pages.length > 0 ? ((currentPage + 1) / pages.length) * 100 : 0}%`,
                    backgroundColor: theme.primary,
                    alignSelf: isRtl ? 'flex-end' : 'flex-start',
                  },
                ]}
              />
            </View>
          </View>

          <TouchableOpacity
            style={styles.scrubberButton}
            onPress={isRtl ? goToPreviousPage : goToNextPage}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Chapter Navigation & Indicator */}
        <View style={styles.chapterNavRow}>
          {readerSettings.chapterChangeArrows === 'left' ? (
            <>
              <View style={styles.navButtonsGroup}>
                <TouchableOpacity
                  style={[styles.chapterNavButton, !previousChapter && styles.disabledButton]}
                  onPress={goToPreviousChapter}
                  disabled={!previousChapter}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="play-skip-back" size={18} color={previousChapter ? '#fff' : '#555'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chapterNavButton, !nextChapter && styles.disabledButton]}
                  onPress={goToNextChapter}
                  disabled={!nextChapter}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="play-skip-forward" size={18} color={nextChapter ? '#fff' : '#555'} />
                </TouchableOpacity>
              </View>

              <View style={styles.pageIndicator}>
                <Text style={styles.pageIndicatorText}>
                  {getPageIndicatorText()}
                </Text>
              </View>
            </>
          ) : readerSettings.chapterChangeArrows === 'right' ? (
            <>
              <View style={styles.pageIndicator}>
                <Text style={styles.pageIndicatorText}>
                  {getPageIndicatorText()}
                </Text>
              </View>

              <View style={styles.navButtonsGroup}>
                <TouchableOpacity
                  style={[styles.chapterNavButton, !previousChapter && styles.disabledButton]}
                  onPress={goToPreviousChapter}
                  disabled={!previousChapter}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="play-skip-back" size={18} color={previousChapter ? '#fff' : '#555'} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chapterNavButton, !nextChapter && styles.disabledButton]}
                  onPress={goToNextChapter}
                  disabled={!nextChapter}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="play-skip-forward" size={18} color={nextChapter ? '#fff' : '#555'} />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.chapterNavButton, !previousChapter && styles.disabledButton]}
                onPress={goToPreviousChapter}
                disabled={!previousChapter}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="play-skip-back" size={18} color={previousChapter ? '#fff' : '#555'} />
              </TouchableOpacity>

              <View style={styles.pageIndicator}>
                <Text style={styles.pageIndicatorText}>
                  {getPageIndicatorText()}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.chapterNavButton, !nextChapter && styles.disabledButton]}
                onPress={goToNextChapter}
                disabled={!nextChapter}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="play-skip-forward" size={18} color={nextChapter ? '#fff' : '#555'} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </Animated.View>

      {/* Spotify Mini Player */}
      <Animated.View
        style={[styles.spotifyContainer, { opacity: showControls ? fadeAnim : 0 }]}
        pointerEvents={showControls ? 'auto' : 'none'}
      >
        <SpotifyMiniPlayer onPickerVisibleChange={setSpotifyPickerOpen} />
      </Animated.View>

      {/* Info Modal */}
      <InfoModal
        visible={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        manga={manga}
        chapter={chapter}
        currentPage={currentPage}
        totalPages={pages.length}
        onContinueReading={() => {}}
        onSearchTag={(tag) => {
          navigation.navigate('Main', {
            screen: 'Search',
            params: { initialQuery: tag },
          } as any);
        }}
      />

      {/* Reader Settings Modal (Original Paperback Schema) */}
      <ReaderSettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={readerSettings}
        onUpdateSetting={handleUpdateSetting}
        isCustom={isCustomSetting}
        onApplyGlobally={handleApplyGlobally}
        onResetToGlobal={handleResetToGlobal}
        mangaTitle={manga?.title}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  pageGroupContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  doublePageRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  pagePlaceholderText: {
    color: '#666',
    marginTop: 12,
    fontSize: 12,
  },
  pageErrorText: {
    color: '#888',
    fontSize: 13,
    marginTop: 10,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 18,
    backgroundColor: '#FA6432',
    borderRadius: 20,
    gap: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
  },
  errorActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  errorActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: '#FA6432',
    gap: 8,
  },
  errorBypassButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    gap: 8,
  },
  errorActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  backButtonFloat: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 36) + 8,
    left: 10,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 22,
    zIndex: 100,
  },
  floatingBackButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 36) + 8,
    left: 16,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    zIndex: 20,
  },
  floatingPageIndicator: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    zIndex: 20,
  },
  floatingPageText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingTop: Platform.OS === 'ios' ? 50 : (StatusBar.currentHeight || 36) + 8,
    zIndex: 30,
  },
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  mangaTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  chapterInfo: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 2,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 19,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.88)',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 12,
    zIndex: 30,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 12,
  },
  scrubberButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  scrubberTouchArea: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  scrubberTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  scrubberProgress: {
    height: '100%',
    borderRadius: 2,
  },
  chapterNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  navButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chapterNavButton: {
    width: 42,
    height: 42,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 21,
  },
  disabledButton: {
    opacity: 0.3,
  },
  pageIndicator: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 18,
  },
  pageIndicatorText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  spotifyContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 170 : 150,
    left: 16,
    right: 16,
    zIndex: 25,
  },
  transitionContainer: {
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  transitionContent: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  transitionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  transitionLabel: {
    fontSize: 11,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  transitionChapterTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FA6432',
    marginTop: 4,
    textAlign: 'center',
  },
  transitionButton: {
    backgroundColor: '#FA6432',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 8,
    marginTop: 14,
  },
  transitionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  infoModalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  infoModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  infoModalContent: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  infoModalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoModalScroll: {
    paddingHorizontal: 20,
  },
  infoModalHeader: {
    flexDirection: 'row',
    paddingTop: 20,
    marginBottom: 20,
    gap: 16,
  },
  infoModalCover: {
    width: 110,
    height: 160,
    borderRadius: 12,
  },
  infoModalHeaderInfo: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 30,
  },
  infoModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  infoModalAuthor: {
    fontSize: 14,
    color: '#888',
    marginBottom: 12,
  },
  infoModalStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  infoModalStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  infoModalButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  infoModalReadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD6E8',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  infoModalReadButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  infoModalIconButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoModalDescSection: {
    marginBottom: 16,
  },
  infoModalDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: '#ccc',
  },
  infoModalMoreButton: {
    fontSize: 14,
    color: '#FA6432',
    marginTop: 6,
    textAlign: 'right',
  },
  infoModalTagsSection: {
    marginBottom: 20,
  },
  infoModalTagsLabelContainer: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  infoModalTagsLabel: {
    fontSize: 13,
    color: '#888',
    backgroundColor: '#2c2c2e',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: 'hidden',
  },
  infoModalGenres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoModalGenreTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  infoModalGenreText: {
    fontSize: 13,
    color: '#fff',
  },
});
