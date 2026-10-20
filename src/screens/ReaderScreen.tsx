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
  Share,
} from 'react-native';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Sharing from 'expo-sharing';
import { Image as ExpoImage } from 'expo-image';
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
import { ReaderSettingsModal, ReaderSettingsScope } from '../components/ReaderSettingsModal';

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
        await ExpoImage.prefetch(decryptedUrl, 'memory-disk').catch(() => {});
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
      if (headers) {
        await ExpoImage.prefetch(page.imageUrl, { headers, cachePolicy: 'memory-disk' }).catch(() => {});
      } else {
        await ExpoImage.prefetch(page.imageUrl, 'memory-disk').catch(() => {});
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

const formatRelativeTime = (dateString?: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 0) return '';
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m`;
  }
  if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    return `${hrs} hr`;
  }
  const days = Math.floor(diffSec / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

// Paperback Info Modal Component (matching info_in_readerscreen.png & info_readerscreen.png)
const InfoModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  manga: Manga | null;
  chapter: Chapter | null;
  currentPage: number;
  totalPages: number;
  onContinueReading: () => void;
  onSearchTag: (tag: string) => void;
  onSelectChapter: (chapterId: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}> = ({
  visible,
  onClose,
  manga,
  chapter,
  currentPage,
  totalPages,
  onContinueReading,
  onSearchTag,
  onSelectChapter,
  isBookmarked,
  onToggleBookmark,
}) => {
  const [showFullDescription, setShowFullDescription] = useState(false);

  if (!manga || !chapter) return null;

  const handleContinue = () => {
    onClose();
    onContinueReading();
  };

  const handleTagPress = (tag: string) => {
    onClose();
    onSearchTag(tag);
  };

  const handleShare = async () => {
    try {
      await Share.share({
        title: manga.title,
        message: `${manga.title} - Chapter ${chapter.number}\nRead on Paperback`,
      });
    } catch {}
  };

  const isCompleted = manga.status?.toLowerCase() === 'completed';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.infoModalContainer}>
        <TouchableOpacity style={styles.infoModalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.infoModalContent}>
          {/* Sheet Handle */}
          <View style={styles.sheetHandle} />

          <ScrollView style={styles.infoModalScroll} showsVerticalScrollIndicator={false}>
            {/* Hero Cover Banner with smooth bottom gradient fade */}
            <View style={styles.infoHeroBanner}>
              {manga.coverImage ? (
                <ExpoImage
                  source={{ uri: manga.coverImage }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : null}
              <LinearGradient
                colors={['transparent', 'rgba(12, 12, 13, 0.45)', 'rgba(12, 12, 13, 0.95)', '#0C0C0D']}
                style={styles.infoHeroGradient}
              />

              <View style={styles.infoHeroContent}>
                <Text style={styles.infoHeroTitle} numberOfLines={2}>
                  {manga.title}
                </Text>
                <View style={styles.infoHeroMetaRow}>
                  <View style={styles.infoHeroStatusWrap}>
                    <View style={[styles.infoStatusDot, { backgroundColor: isCompleted ? '#34C759' : '#FA6432' }]} />
                    <Text style={styles.infoHeroMetaText}>
                      {isCompleted ? 'Completed' : 'Ongoing'}
                    </Text>
                  </View>
                  {manga.author ? (
                    <View style={styles.infoHeroMetaItem}>
                      <Ionicons name="pencil" size={12} color="#8E8E93" style={{ marginRight: 4 }} />
                      <Text style={styles.infoHeroMetaText} numberOfLines={1}>{manga.author}</Text>
                    </View>
                  ) : null}
                  {manga.artist && manga.artist !== manga.author ? (
                    <View style={styles.infoHeroMetaItem}>
                      <Ionicons name="color-palette-outline" size={12} color="#8E8E93" style={{ marginRight: 4 }} />
                      <Text style={styles.infoHeroMetaText} numberOfLines={1}>{manga.artist}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Action Buttons: Read Now (Coral) + Bookmark + Share */}
            <View style={styles.infoActionRow}>
              <TouchableOpacity style={styles.infoReadNowButton} onPress={handleContinue} activeOpacity={0.8}>
                <Ionicons name="book" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.infoReadNowButtonText}>Read Now</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.infoSquareButton, isBookmarked && styles.infoSquareButtonActive]}
                onPress={onToggleBookmark}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color={isBookmarked ? '#FA233B' : '#FFFFFF'}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.infoSquareButton} onPress={handleShare} activeOpacity={0.7}>
                <Ionicons name="share-outline" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Synopsis / Description with More toggle */}
            <View style={styles.infoSection}>
              <TouchableOpacity
                onPress={() => setShowFullDescription(!showFullDescription)}
                activeOpacity={0.7}
                style={styles.infoDescContainer}
              >
                <Text
                  style={styles.infoDescriptionText}
                  numberOfLines={showFullDescription ? undefined : 3}
                >
                  {manga.description || 'No description'}
                </Text>
                {manga.description && manga.description.length > 100 ? (
                  <Text style={styles.infoMoreText}>
                    {showFullDescription ? 'Less' : 'More'}
                  </Text>
                ) : null}
              </TouchableOpacity>
            </View>

            {/* Tag Pills */}
            {manga.genres && manga.genres.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.infoTagsScroll}
              >
                {manga.genres.map((genre, idx) => (
                  <TouchableOpacity
                    key={`${genre}-${idx}`}
                    style={styles.infoTagPill}
                    onPress={() => handleTagPress(genre)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.infoTagPillText}>{genre}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            {/* Source Badge & More Button */}
            <View style={styles.infoSourceRow}>
              <View style={styles.infoSourcePill}>
                <Text style={styles.infoSourcePillText}>{manga.source || 'Source'}</Text>
              </View>
              <TouchableOpacity style={styles.infoSourceMoreButton} activeOpacity={0.7}>
                <Ionicons name="ellipsis-horizontal" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Chapters List */}
            {manga.chapters && manga.chapters.length > 0 ? (
              <>
                <View style={styles.infoChaptersHeader}>
                  <Text style={styles.infoChaptersTitle}>Chapters</Text>
                  <Text style={styles.infoChaptersCount}>{manga.chapters.length}</Text>
                </View>
                <View style={styles.infoChaptersList}>
                  {manga.chapters.map((ch) => {
                    const isCurrent = ch.id === chapter.id;
                    return (
                      <TouchableOpacity
                        key={ch.id}
                        style={[styles.infoChapterRow, isCurrent && styles.infoChapterRowCurrent]}
                        onPress={() => {
                          onClose();
                          onSelectChapter(ch.id);
                        }}
                        activeOpacity={0.6}
                      >
                        <View style={styles.infoChapterInfo}>
                          <Text style={[styles.infoChapterName, isCurrent && { color: '#FA233B' }]} numberOfLines={1}>
                            Ch. {ch.number}{ch.title ? ` - ${ch.title}` : ''}
                          </Text>
                          <View style={styles.infoChapterSub}>
                            <Text style={styles.infoChapterPage}>Page: {isCurrent ? currentPage + 1 : 1}</Text>
                            <Text style={styles.infoChapterLang}>JP</Text>
                          </View>
                        </View>
                        {ch.releaseDate ? (
                          <Text style={styles.infoChapterDate}>{formatRelativeTime(ch.releaseDate)}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const tr = (key: string, fallback: string): string => {
  const value = t(key);
  return !value || value === key ? fallback : value;
};

// Distance (px) the user has to pull past the first/last page to switch chapter
const PULL_THRESHOLD = 110;
// Typical manga page ratio, used until the real bitmap size is known
const DEFAULT_PAGE_ASPECT = 1.42;

let chapterAspectEstimate = DEFAULT_PAGE_ASPECT;

// Single page image. The slot keeps a stable size (cached or estimated aspect ratio) and the
// bitmap is decoded off the JS thread by expo-image, so the list never remounts or re-flows
// while pages stream in - that remount/re-layout churn is what made scrolling stutter.
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
  const [aspect, setAspect] = useState<number>(
    () => page.aspectRatio || pageDimensionsCache.get(url) || chapterAspectEstimate
  );
  const [loadError, setLoadError] = useState(false);
  const requestHeaders = useMemo(() => getImageRequestHeaders(url), [url]);
  const source = useMemo(
    () => (requestHeaders ? { uri: url, headers: requestHeaders } : { uri: url }),
    [url, requestHeaders]
  );

  // Stable handlers so parent re-renders never re-create the touch targets
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    setLoadError(false);
  }, [url, page.retryKey]);

  const slotHeight = isVertical ? Math.round(targetWidth * (aspect || DEFAULT_PAGE_ASPECT)) : targetHeight;
  const showError = loadError || !!page.error;

  if (showError) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={(e) => onPressRef.current(e)}
        style={[styles.pagePlaceholder, { width: targetWidth, height: slotHeight }]}
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

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={(e) => onPressRef.current(e)}
      onLongPress={() => onLongPressRef.current()}
      delayLongPress={450}
      style={{ width: targetWidth, height: slotHeight }}
    >
      {!page.loading && page.preloaded ? (
        <ExpoImage
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit={fitMode}
          recyclingKey={`${page.id}-${page.retryKey || 0}`}
          cachePolicy="memory-disk"
          allowDownscaling={downsamplePages}
          transition={0}
          onLoad={(e) => {
            const w = e?.source?.width;
            const h = e?.source?.height;
            if (w && h && w > 0 && h > 0) {
              const ratio = h / w;
              pageDimensionsCache.set(url, ratio);
              chapterAspectEstimate = ratio;
              if (isVertical && (!aspect || Math.abs(aspect - ratio) > 0.05)) {
                setAspect(ratio);
              }
            }
          }}
          onError={() => {
            console.warn('[Reader] Error rendering page:', page.pageNumber);
            setLoadError(true);
          }}
        />
      ) : null}
      {page.loading ? (
        <View style={styles.pageSpinner} pointerEvents="none">
          <ActivityIndicator size="large" color="#FA6432" />
          <Text style={styles.pagePlaceholderText}>
            {t('reader.loadingPage', { page: page.pageNumber, total: totalPages })}
          </Text>
        </View>
      ) : null}
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

export const ReaderScreen: React.FC = () => {
  const route = useRoute<ReaderRouteProp>();
  const navigation = useNavigation<ReaderNavigationProp>();
  const { theme } = useTheme();
  const { library, updateProgress, addToLibrary, removeFromLibrary } = useLibrary();
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
  const [settingsScope, setSettingsScope] = useState<ReaderSettingsScope>('global');
  const [globalSettings, setGlobalSettings] = useState<ReaderSettingsValues>(defaultReaderSettings);
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
      const globalResult = isCustom ? await getReaderSettings() : { settings };
      if (isMounted) {
        setReaderSettings(settings);
        setGlobalSettings(globalResult.settings);
        setSettingsScope(isCustom ? 'manga' : 'global');
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
      if (isCustomSetting) {
        await saveReaderSettings(updated, mangaId);
      } else {
        await saveReaderSettings(updated);
        setGlobalSettings(updated);
      }
    },
    [readerSettings, isCustomSetting, mangaId]
  );

  // Update from the settings sheet - honours the Global / Manga scope selector
  const handleModalUpdateSetting = useCallback(
    async <K extends keyof ReaderSettingsValues>(key: K, value: ReaderSettingsValues[K]) => {
      if (key === 'readerMode') {
        isModeSwitchingRef.current = true;
      }
      if (settingsScope === 'manga') {
        const updated = { ...readerSettings, [key]: value };
        setReaderSettings(updated);
        setIsCustomSetting(true);
        await saveReaderSettings(updated, mangaId);
      } else {
        const updatedGlobal = { ...globalSettings, [key]: value };
        setGlobalSettings(updatedGlobal);
        await saveReaderSettings(updatedGlobal);
        // Also apply to current reader view immediately
        setReaderSettings((prev) => ({ ...prev, [key]: value }));
      }
    },
    [settingsScope, readerSettings, globalSettings, mangaId]
  );

  // Apply Globally
  const handleApplyGlobally = useCallback(async () => {
    await applySettingsGlobally(readerSettings, mangaId);
    setGlobalSettings(readerSettings);
    setSettingsScope('global');
    setIsCustomSetting(false);
    Alert.alert(t('common.success'), 'Settings applied globally for all titles.');
  }, [readerSettings, mangaId]);

  // Reset to Global Defaults
  const handleResetToGlobal = useCallback(async () => {
    await resetMangaReaderSettings(mangaId);
    const { settings } = await getReaderSettings();
    setReaderSettings(settings);
    setGlobalSettings(settings);
    setSettingsScope('global');
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
  const toggleQuickMode = useCallback(async () => {
    const nextMode: ReaderMode = readerSettings.readerMode === 'horizontal' ? 'longStrip' : 'horizontal';
    isModeSwitchingRef.current = true;
    const updated = { ...readerSettings, readerMode: nextMode };
    setReaderSettings(updated);
    if (isCustomSetting) {
      await saveReaderSettings(updated, mangaId);
    } else {
      await saveReaderSettings(updated);
      setGlobalSettings(updated);
    }
  }, [readerSettings, isCustomSetting, mangaId]);

  // Switch to specific chapter
  const goToChapter = useCallback((targetChapterId: string) => {
    if (!manga || isTransitioning || targetChapterId === chapterId) return;
    setIsTransitioning(true);
    navigation.replace('Reader', { mangaId: manga.id, chapterId: targetChapterId, sourceId });
  }, [manga, isTransitioning, chapterId, sourceId, navigation]);

  // Toggle bookmark in library
  const toggleBookmark = useCallback(async () => {
    if (!manga) return;
    try {
      if (isBookmarked) {
        await removeFromLibrary(manga.id);
        setIsBookmarked(false);
      } else {
        await addToLibrary(manga);
        setIsBookmarked(true);
      }
    } catch (e) {
      console.warn('[Reader] Failed to toggle bookmark:', e);
    }
  }, [manga, isBookmarked, removeFromLibrary, addToLibrary]);

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

          const skeletonPages: PreloadedPage[] = pageData.map((p) => {
            const needsResolve = !!parseDrmUrl(p.imageUrl);
            return {
              ...p,
              resolvedUrl: p.imageUrl,
              preloaded: !needsResolve,
              loading: needsResolve,
              error: false,
            };
          });

          setPages(skeletonPages);
          setLoading(false);

          // Regular pages are streamed lazily by the image component (no up-front prefetch of the
          // whole chapter, which used to flood the JS thread with state updates). Only DRM pages
          // need to be decrypted before they can be shown.
          const drmPages = pageData.filter((p) => !!parseDrmUrl(p.imageUrl));
          if (drmPages.length > 0) {
            await preloadAllPagesWithProgress(
              drmPages,
              () => {},
              (_index, loadedPage) => {
                setPages((prev) => {
                  const at = prev.findIndex((p) => p.id === loadedPage.id);
                  if (at === -1) return prev;
                  const next = [...prev];
                  next[at] = loadedPage;
                  return next;
                });
              }
            );
          }

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
    const amount = readerSettings.pillarboxAmount ?? 0;
    if (amount <= 0) return false;
    if (readerSettings.pillarboxOrientation === 'both') return true;
    if (readerSettings.pillarboxOrientation === 'landscape') return isLandscape;
    if (readerSettings.pillarboxOrientation === 'portrait') return !isLandscape;
    return false;
  }, [readerSettings.pillarboxAmount, readerSettings.pillarboxOrientation, isLandscape]);

  const pillarboxMargin = useMemo(() => {
    if (!isPillarboxed) return 0;
    return Math.round(screenWidth * ((readerSettings.pillarboxAmount ?? 0) / 100));
  }, [isPillarboxed, screenWidth, readerSettings.pillarboxAmount]);

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
        return `${currentGroup.startPageNumber} - ${currentGroup.endPageNumber} of ${pages.length}`;
      }
    }
    return `${currentPage + 1} of ${pages.length}`;
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

  // Warm the cache for the next few pages so they are decoded before the user gets there
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const prefetchAhead = useCallback((fromIndex: number) => {
    const list = pagesRef.current;
    for (let i = fromIndex + 1; i <= fromIndex + 3 && i < list.length; i++) {
      const p = list[i];
      if (!p || !p.preloaded || p.error) continue;
      const u = p.resolvedUrl || p.imageUrl;
      if (!u || /^(file|content|drm):/i.test(u)) continue;
      if (getImageRequestHeaders(u)) continue; // needs custom headers - handled by the image view itself
      try {
        const task = ExpoImage.prefetch(u, 'memory-disk');
        if (task && typeof (task as any).catch === 'function') (task as any).catch(() => {});
      } catch {}
    }
  }, []);

  // Pull past the first / last page to open the previous / next chapter (Paperback style)
  const scrollMetricsRef = useRef({ y: 0, contentH: 0, layoutH: 0 });
  const pullStateRef = useRef<{
    startY: number;
    atTop: boolean;
    atBottom: boolean;
    edge: 'top' | 'bottom' | null;
    ready: boolean;
  }>({ startY: 0, atTop: false, atBottom: false, edge: null, ready: false });
  const [pullMode, setPullMode] = useState<{ edge: 'top' | 'bottom' | null; ready: boolean }>({
    edge: null,
    ready: false,
  });
  const pullProgress = useRef(new Animated.Value(0)).current;
  const pullTranslateAnim = useRef(new Animated.Value(0)).current;

  const setPull = useCallback(
    (edge: 'top' | 'bottom' | null, ready: boolean, progress: number) => {
      pullProgress.setValue(progress);
      const st = pullStateRef.current;
      if (st.edge !== edge || st.ready !== ready) {
        st.edge = edge;
        st.ready = ready;
        setPullMode({ edge, ready });
      }
    },
    [pullProgress]
  );

  const handleVerticalScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    scrollMetricsRef.current = {
      y: contentOffset.y,
      contentH: contentSize.height,
      layoutH: layoutMeasurement.height,
    };
  }, []);

  const handlePullTouchStart = (e: GestureResponderEvent) => {
    if (readerSettings.readerMode === 'horizontal') return;
    const { y, contentH, layoutH } = scrollMetricsRef.current;
    const st = pullStateRef.current;
    st.startY = e.nativeEvent.pageY;
    st.atTop = y <= 2;
    st.atBottom = contentH > 0 && y + layoutH >= contentH - 2;
  };

  const handlePullTouchMove = (e: GestureResponderEvent) => {
    const st = pullStateRef.current;
    if (!st.atTop && !st.atBottom) return;
    const { y, contentH, layoutH } = scrollMetricsRef.current;
    const dy = e.nativeEvent.pageY - st.startY;
    let edge: 'top' | 'bottom' | null = null;
    let amount = 0;
    if (st.atTop && dy > 0 && y <= 24) {
      edge = 'top';
      amount = dy;
    } else if (st.atBottom && dy < 0 && y + layoutH >= contentH - 24) {
      edge = 'bottom';
      amount = -dy;
    }
    if (!edge || amount < 12) {
      if (st.edge) {
        setPull(null, false, 0);
        pullTranslateAnim.setValue(0);
      }
      return;
    }
    const chapterExists = edge === 'top' ? !!previousChapter : !!nextChapter;
    setPull(edge, chapterExists && amount >= PULL_THRESHOLD, Math.min(amount / PULL_THRESHOLD, 1.2));
    const damped = edge === 'top' ? Math.min(amount * 0.45, 140) : Math.max(-amount * 0.45, -140);
    pullTranslateAnim.setValue(damped);
  };

  const handlePullTouchEnd = (cancelled: boolean) => {
    const st = pullStateRef.current;
    const edge = st.edge;
    const shouldNavigate = !cancelled && st.ready && !!edge;
    st.atTop = false;
    st.atBottom = false;
    Animated.spring(pullTranslateAnim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
    if (st.edge) setPull(null, false, 0);
    if (shouldNavigate && !isTransitioning) {
      if (edge === 'top') goToPreviousChapter();
      else goToNextChapter();
    }
  };

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
        prefetchAhead(newPage);
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
    <View
      style={[styles.container, { backgroundColor: readerBgColor }]}
      onTouchStart={handlePullTouchStart}
      onTouchMove={handlePullTouchMove}
      onTouchEnd={() => handlePullTouchEnd(false)}
      onTouchCancel={() => handlePullTouchEnd(true)}
    >
      <StatusBar hidden={!showControls} barStyle="light-content" />

      {/* FlatList Container with Pull-to-change Rubber Band */}
      <View style={{ flex: 1, backgroundColor: readerBgColor, overflow: 'hidden' }}>
        {pullMode.edge === 'top' ? (
          <View style={styles.pullHeaderArea} pointerEvents="none">
            <Text style={styles.pullActionText}>
              {(pullMode.ready ? tr('reader.release', 'Release') : tr('reader.pullDown', 'Pull down')).toUpperCase()}
            </Text>
            <Text style={styles.pullTargetText}>
              {(previousChapter ? t('reader.previousChapter') : t('reader.noPreviousChapter')).toUpperCase()}
            </Text>
          </View>
        ) : null}

        {pullMode.edge === 'bottom' ? (
          <View style={styles.pullFooterArea} pointerEvents="none">
            <Text style={styles.pullActionText}>
              {(pullMode.ready ? tr('reader.release', 'Release') : tr('reader.pullUp', 'Pull up')).toUpperCase()}
            </Text>
            <Text style={styles.pullTargetText}>
              {(nextChapter ? t('reader.nextChapter') : t('reader.noNextChapter')).toUpperCase()}
            </Text>
          </View>
        ) : null}

        <Animated.View style={{ flex: 1, transform: [{ translateY: pullTranslateAnim }] }}>
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
              initialNumToRender={4}
              maxToRenderPerBatch={6}
              windowSize={11}
              removeClippedSubviews={Platform.OS === 'android'}
              updateCellsBatchingPeriod={30}
              extraData={{ screenWidth, screenHeight, isLandscape, isPillarboxed }}
              onScroll={handleVerticalScroll}
              onScrollToIndexFailed={(info) => {
                flatListRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: false,
                });
                setTimeout(() => {
                  flatListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 });
                }, 120);
              }}
              bounces
              scrollEventThrottle={16}
            />
          )}
        </Animated.View>
      </View>

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

      {/* Pull-to-change-chapter hint ("RELEASE / PREVIOUS CHAPTER") */}
      {/* Paperback HUD Overlay (ChapterRendererOverlayView) */}
      <Animated.View
        style={[styles.topBar, { opacity: fadeAnim }]}
        pointerEvents={showControls ? 'box-none' : 'none'}
      >
        <View style={styles.topPill}>
          <View style={styles.titleContainer}>
            <Text style={styles.mangaTitle} numberOfLines={1}>
              {manga?.title}
            </Text>
            <Text style={styles.chapterInfo} numberOfLines={1}>
              Ch. {chapter?.number}{chapter?.title ? ` - ${chapter.title}` : ''}
            </Text>
          </View>
          {sourceId ? (
            <TouchableOpacity
              style={styles.pillIconButton}
              onPress={handleOpenWebBypass}
              hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            >
              <Ionicons name="globe-outline" size={20} color="#fff" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.detachedInfoButton}
          onPress={() => setShowInfoModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.infoGlyph}>i</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom controls: quick actions on the left, page pill on the right */}
      <Animated.View
        style={[styles.bottomBar, { opacity: fadeAnim }]}
        pointerEvents={showControls ? 'box-none' : 'none'}
      >
        <View style={styles.bottomRow}>
          {readerSettings.chapterChangeArrows === 'left' ? (
            <View style={styles.pagePill}>
              <TouchableOpacity
                style={styles.pillChevron}
                onPress={readerSettings.readerMode === 'horizontal' && isRtl ? goToNextPage : goToPreviousPage}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.pagePillText}>{getPageIndicatorText()}</Text>
              <TouchableOpacity
                style={styles.pillChevron}
                onPress={readerSettings.readerMode === 'horizontal' && isRtl ? goToPreviousPage : goToNextPage}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.bottomLeft}>
            <TouchableOpacity style={styles.roundButton} onPress={toggleQuickMode} activeOpacity={0.8}>
              <MaterialCommunityIcons name="swap-horizontal" size={24} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.roundButton} onPress={toggleOrientationLock} activeOpacity={0.8}>
              <MaterialCommunityIcons
                name={orientationLocked ? 'screen-rotation-lock' : 'screen-rotation'}
                size={22}
                color={orientationLocked ? '#FA233B' : '#fff'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.roundButton}
              onPress={() => setShowSettingsModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="settings-sharp" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          {readerSettings.chapterChangeArrows !== 'left' ? (
            <View style={styles.pagePill}>
              <TouchableOpacity
                style={styles.pillChevron}
                onPress={readerSettings.readerMode === 'horizontal' && isRtl ? goToNextPage : goToPreviousPage}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.pagePillText}>{getPageIndicatorText()}</Text>
              <TouchableOpacity
                style={styles.pillChevron}
                onPress={readerSettings.readerMode === 'horizontal' && isRtl ? goToPreviousPage : goToNextPage}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
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
        onContinueReading={() => setShowInfoModal(false)}
        onSearchTag={(tag) => {
          setShowInfoModal(false);
          navigation.navigate('Main', {
            screen: 'Search',
            params: { initialQuery: tag },
          } as any);
        }}
        onSelectChapter={goToChapter}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
      />

      {/* Reader Settings Modal (Original Paperback Schema) */}
      <ReaderSettingsModal
        visible={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={settingsScope === 'global' ? globalSettings : readerSettings}
        onUpdateSetting={handleModalUpdateSetting}
        scope={settingsScope}
        onScopeChange={setSettingsScope}
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
    paddingTop: Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight || 36) + 8,
    paddingHorizontal: 12,
    zIndex: 30,
  },
  topPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderRadius: 26,
    paddingLeft: 18,
    paddingRight: 8,
    height: 52,
  },
  titleContainer: {
    flex: 1,
    marginRight: 8,
  },
  mangaTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  chapterInfo: {
    fontSize: 13,
    color: '#9a9a9f',
    marginTop: 2,
  },
  pillIconButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detachedInfoButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoGlyph: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
    zIndex: 30,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.88)',
    borderRadius: 22,
    height: 44,
    minWidth: 140,
    paddingHorizontal: 12,
    gap: 10,
  },
  pillChevron: {
    width: 26,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pagePillText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  pullHeaderArea: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 140 : (StatusBar.currentHeight || 36) + 90,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  pullFooterArea: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  pullActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  pullTargetText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 4,
  },
  pullLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  pullLabelTop: {
    top: Platform.OS === 'ios' ? 170 : (StatusBar.currentHeight || 36) + 130,
  },
  pullLabelBottom: {
    bottom: 130,
  },
  pullLabelText: {
    color: '#9a9a9f',
    fontSize: 17,
    fontWeight: '500',
    letterSpacing: 0.5,
    textAlign: 'center',
    lineHeight: 24,
  },
  pageSpinner: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spotifyContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 120 : 100,
    left: 16,
    right: 16,
    zIndex: 25,
  },
  transitionContainer: {
    minHeight: 64,
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
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  infoModalContent: {
    backgroundColor: '#0C0C0D',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '88%',
    overflow: 'hidden',
  },
  infoModalScroll: {
    flex: 1,
  },
  infoHeroBanner: {
    height: 280,
    width: '100%',
    position: 'relative',
  },
  infoHeroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  infoHeroContent: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
  },
  infoHeroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 4,
  },
  infoHeroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 14,
  },
  infoHeroStatusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  infoHeroMetaText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#A0A0A5',
  },
  infoHeroMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  infoReadNowButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FF5A5F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoReadNowButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  infoSquareButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSquareButtonActive: {
    borderWidth: 1,
    borderColor: '#FA233B',
  },
  infoSection: {
    paddingHorizontal: 16,
    marginTop: 14,
  },
  infoDescContainer: {
    flexDirection: 'column',
  },
  infoDescriptionText: {
    fontSize: 14,
    color: '#A0A0A5',
    lineHeight: 20,
  },
  infoMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  infoTagsScroll: {
    paddingHorizontal: 16,
    marginTop: 14,
    gap: 8,
  },
  infoTagPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  infoTagPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  infoSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 14,
  },
  infoSourcePill: {
    backgroundColor: '#FF5A5F',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  infoSourcePillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  infoSourceMoreButton: {
    width: 38,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoChaptersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 18,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2C2C2E',
  },
  infoChaptersTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  infoChaptersCount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8E8E93',
  },
  infoChaptersList: {
    paddingHorizontal: 16,
  },
  infoChapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1C1C1E',
  },
  infoChapterRowCurrent: {
    backgroundColor: 'rgba(250,35,59,0.08)',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  infoChapterInfo: {
    flex: 1,
    marginRight: 12,
  },
  infoChapterName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  infoChapterSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoChapterPage: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FA233B',
  },
  infoChapterLang: {
    fontSize: 13,
    color: '#8E8E93',
  },
  infoChapterDate: {
    fontSize: 13,
    color: '#8E8E93',
  },
});
