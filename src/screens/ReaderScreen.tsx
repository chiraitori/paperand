import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { LoadingIndicator } from '../components';
import { getMangaById, getChapterById } from '../data/mockData';
import { getChapterPages, getMangaDetails, getChapters } from '../services/sourceService';
import { Manga, Chapter, Page, RootStackParamList } from '../types';

type ReaderRouteProp = RouteProp<RootStackParamList, 'Reader'>;
type ReaderNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width, height } = Dimensions.get('window');

// Component for auto-sizing images
const AutoSizeImage: React.FC<{ uri: string; onPress: () => void }> = ({ uri, onPress }) => {
  const [imageHeight, setImageHeight] = useState(width * 1.4);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => {
        const ratio = width / w;
        setImageHeight(h * ratio);
      },
      () => {
        setImageHeight(width * 1.4);
      }
    );
  }, [uri]);

  return (
    <TouchableOpacity activeOpacity={1} onPress={onPress}>
      <Image
        source={{ uri }}
        style={{ width: width, height: imageHeight }}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
};

export const ReaderScreen: React.FC = () => {
  const { theme } = useTheme();
  const route = useRoute<ReaderRouteProp>();
  const navigation = useNavigation<ReaderNavigationProp>();
  const { updateProgress } = useLibrary();
  
  const [manga, setManga] = useState<Manga | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [readingMode, setReadingMode] = useState<'vertical' | 'horizontal'>('vertical');
  const [pages, setPages] = useState<Page[]>([]);
  
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const flatListRef = useRef<FlatList>(null);

  const { mangaId, chapterId, sourceId } = route.params;

  useEffect(() => {
    loadData();
  }, [mangaId, chapterId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (showControls) {
        hideControls();
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [showControls]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      console.log('[Reader] loadData called with:', { mangaId, chapterId, sourceId });
      
      // If sourceId is provided, load from extension
      if (sourceId) {
        console.log('[Reader] Loading from extension:', sourceId, mangaId, chapterId);
        
        // Fetch manga details and chapters from extension for proper history tracking
        const [pageUrls, mangaDetails, chaptersData] = await Promise.all([
          getChapterPages(sourceId, mangaId, chapterId),
          getMangaDetails(sourceId, mangaId),
          getChapters(sourceId, mangaId),
        ]);
        
        console.log('[Reader] Got pages:', pageUrls.length);
        
        if (pageUrls.length > 0) {
          // Find the current chapter info
          const currentChapter = chaptersData.find(ch => ch.id === chapterId);
          
          // Create a proper manga object with real data for library/history
          const mangaData: Manga = {
            id: mangaId,
            title: mangaDetails?.titles?.[0] || 'Unknown Manga',
            author: mangaDetails?.author || '',
            description: mangaDetails?.desc || '',
            coverImage: mangaDetails?.image || '',
            genres: mangaDetails?.tags?.map(t => t.label) || [],
            status: mangaDetails?.status === 'Completed' ? 'completed' : 'ongoing',
            chapters: chaptersData.map(ch => ({
              id: ch.id,
              mangaId: mangaId,
              number: ch.chapNum,
              title: ch.name || `Chapter ${ch.chapNum}`,
              pages: [],
              releaseDate: ch.time || new Date().toISOString(),
              isRead: false,
            })),
            lastUpdated: new Date().toISOString(),
            source: sourceId,
          };
          setManga(mangaData);
          
          // Create chapter object
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
          
          // Convert page URLs to Page objects
          const pageData: Page[] = pageUrls.map((url, index) => ({
            id: `${chapterId}-${index}`,
            chapterId: chapterId,
            pageNumber: index + 1,
            imageUrl: url,
          }));
          setPages(pageData);
        }
      } else {
        // Fallback to mock data
        const [mangaData, chapterData] = await Promise.all([
          getMangaById(mangaId),
          getChapterById(mangaId, chapterId),
        ]);
        
        if (mangaData && chapterData) {
          setManga(mangaData);
          setChapter(chapterData);
          setPages(chapterData.pages || []);
        }
      }
    } catch (error) {
      console.error('Failed to load reader data:', error);
    } finally {
      setLoading(false);
    }
  };

  const hideControls = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setShowControls(false));
  };

  const toggleControls = () => {
    if (showControls) {
      hideControls();
    } else {
      setShowControls(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  };

  const saveProgress = useCallback(async (pageNum: number) => {
    if (!manga || !chapter) {
      console.log('[Reader] saveProgress skipped - no manga or chapter');
      return;
    }
    
    console.log('[Reader] Saving progress:', manga.id, chapter.id, 'page:', pageNum);
    
    // Update progress (will add to library if not already there)
    await updateProgress({
      mangaId: manga.id,
      chapterId: chapter.id,
      pageNumber: pageNum,
      lastRead: new Date().toISOString(),
    }, manga);
    
    console.log('[Reader] Progress saved successfully');
  }, [manga, chapter, updateProgress]);

  // Chapters are sorted descending (newest first), so:
  // - Previous chapter (older) = higher index
  // - Next chapter (newer) = lower index
  const goToPreviousChapter = () => {
    if (!manga || !chapter) return;
    const currentIndex = manga.chapters.findIndex(ch => ch.id === chapter.id);
    // Previous = older chapter = higher index in descending sorted array
    if (currentIndex < manga.chapters.length - 1) {
      const prevChapter = manga.chapters[currentIndex + 1];
      navigation.replace('Reader', { mangaId: manga.id, chapterId: prevChapter.id, sourceId });
    }
  };

  const goToNextChapter = () => {
    if (!manga || !chapter) return;
    const currentIndex = manga.chapters.findIndex(ch => ch.id === chapter.id);
    // Next = newer chapter = lower index in descending sorted array
    if (currentIndex > 0) {
      const nextChapter = manga.chapters[currentIndex - 1];
      navigation.replace('Reader', { mangaId: manga.id, chapterId: nextChapter.id, sourceId });
    }
  };

  const renderPage = ({ item, index }: { item: Page; index: number }) => {
    if (readingMode === 'vertical') {
      return <AutoSizeImage uri={item.imageUrl} onPress={toggleControls} />;
    }
    
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={toggleControls}
        style={styles.horizontalPage}
      >
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.horizontalImage}
          resizeMode="contain"
        />
      </TouchableOpacity>
    );
  };

  // Use ref to keep latest saveProgress function for onViewableItemsChanged
  const saveProgressRef = useRef(saveProgress);
  const setCurrentPageRef = useRef(setCurrentPage);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const newPage = viewableItems[0].index;
      console.log('[Reader] Page changed to:', newPage);
      setCurrentPageRef.current(newPage);
      // Use ref to get latest saveProgress function
      saveProgressRef.current(newPage);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  if (loading) {
    return <LoadingIndicator fullScreen message="Loading chapter..." />;
  }

  if (!manga || !chapter || pages.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: theme.card }]}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={[styles.errorText, { color: theme.error }]}>
          {pages.length === 0 ? 'No pages found' : 'Chapter not found'}
        </Text>
      </View>
    );
  }

  // Chapters sorted descending (newest first)
  // Previous (older chapter) = higher index, so check if not at end
  // Next (newer chapter) = lower index, so check if not at start
  const currentIndex = manga.chapters.findIndex(ch => ch.id === chapter.id);
  const hasPreviousChapter = currentIndex < manga.chapters.length - 1;
  const hasNextChapter = currentIndex > 0;

  return (
    <View style={[styles.container, { backgroundColor: '#000000' }]}>
      <StatusBar hidden={showControls === false} />
      
      <FlatList
        ref={flatListRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={item => item.id}
        horizontal={readingMode === 'horizontal' ? true : false}
        pagingEnabled={readingMode === 'horizontal' ? true : false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={3}
        maxToRenderPerBatch={5}
        windowSize={5}
        contentContainerStyle={readingMode === 'vertical' ? styles.verticalContentContainer : undefined}
        ListHeaderComponent={readingMode === 'vertical' ? <View style={styles.firstImageSpacer} /> : null}
      />

      {showControls && (
        <>
          {/* Top Bar */}
          <Animated.View
            style={[
              styles.topBar,
              { opacity: fadeAnim, backgroundColor: 'rgba(0,0,0,0.8)' },
            ]}
          >
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.titleContainer}>
              <Text style={styles.chapterTitle} numberOfLines={1}>
                {manga.title}
              </Text>
              <Text style={styles.chapterNumber}>
                Chapter {chapter.number}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => setReadingMode(readingMode === 'vertical' ? 'horizontal' : 'vertical')}
            >
              <Text style={styles.settingsButtonText}>
                {readingMode === 'vertical' ? '↕️' : '↔️'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Bottom Bar */}
          <Animated.View
            style={[
              styles.bottomBar,
              { opacity: fadeAnim, backgroundColor: 'rgba(0,0,0,0.8)' },
            ]}
          >
            <TouchableOpacity
              style={[styles.navButton, !hasPreviousChapter && styles.disabledButton]}
              onPress={goToPreviousChapter}
              disabled={hasPreviousChapter === false}
            >
              <Text style={[styles.navButtonText, !hasPreviousChapter && styles.disabledText]}>
                ← Previous
              </Text>
            </TouchableOpacity>
            
            <View style={styles.pageIndicator}>
              <Text style={styles.pageText}>
                {currentPage + 1} / {pages.length}
              </Text>
            </View>
            
            <TouchableOpacity
              style={[styles.navButton, !hasNextChapter && styles.disabledButton]}
              onPress={goToNextChapter}
              disabled={hasNextChapter === false}
            >
              <Text style={[styles.navButtonText, !hasNextChapter && styles.disabledText]}>
                Next →
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  verticalContentContainer: {
    flexGrow: 1,
  },
  firstImageSpacer: {
    height: height * 0.15, // 15% of screen height as top padding
  },
  verticalPage: {
    width: width,
    alignItems: 'center',
  },
  horizontalPage: {
    width: width,
    height: height,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verticalImage: {
    width: width,
    height: undefined,
    aspectRatio: undefined,
  },
  horizontalImage: {
    width: width,
    height: height,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 28,
    color: '#FFFFFF',
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  chapterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  chapterNumber: {
    fontSize: 13,
    color: '#CCCCCC',
    marginTop: 2,
  },
  settingsButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButtonText: {
    fontSize: 20,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    paddingBottom: 34,
  },
  navButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.4,
  },
  disabledText: {
    color: '#888888',
  },
  pageIndicator: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  pageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
});
