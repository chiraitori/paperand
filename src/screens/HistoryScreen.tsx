import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import { MangaCard, EmptyState } from '../components';
import { RootStackParamList, LibraryEntry } from '../types';
import { getGeneralSettings, GeneralSettings, defaultSettings } from '../services/settingsService';

type HistoryScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const HistoryScreen: React.FC = () => {
  const { theme } = useTheme();
  const { library, clearHistory } = useLibrary();
  const navigation = useNavigation<HistoryScreenNavigationProp>();
  const [settings, setSettings] = useState<GeneralSettings>(defaultSettings);
  const { width, height } = useWindowDimensions();

  // Determine orientation and get appropriate column count
  const isLandscape = width > height;
  const numColumns = isLandscape ? settings.landscapeColumns : settings.portraitColumns;

  // Load settings when screen is focused
  useFocusEffect(
    useCallback(() => {
      const loadSettings = async () => {
        const loadedSettings = await getGeneralSettings();
        setSettings(loadedSettings);
      };
      loadSettings();
    }, [])
  );

  // Filter and sort by last read
  const readingHistory = library
    .filter(entry => entry.progress !== null)
    .sort((a, b) => {
      const dateA = new Date(a.progress?.lastRead || 0);
      const dateB = new Date(b.progress?.lastRead || 0);
      return dateB.getTime() - dateA.getTime();
    });

  const handleClearHistory = () => {
    Alert.alert(
      'Clear Reading History',
      'Are you sure you want to clear all reading history? This will remove all entries except favorites. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearHistory();
          },
        },
      ]
    );
  };

  const navigateToManga = (entry: LibraryEntry) => {
    navigation.navigate('MangaDetail', {
      mangaId: entry.manga.id,
      sourceId: entry.manga.source
    });
  };

  const renderItem = ({ item }: { item: LibraryEntry }) => (
    <View style={[styles.itemContainer, { maxWidth: `${100 / numColumns - 2}%` }]}>
      <MangaCard
        manga={item.manga}
        onPress={() => navigateToManga(item)}
        compact
        columns={numColumns}
      />
      {item.progress && (
        <Text style={[styles.progressText, { color: theme.textSecondary }]}>
          Ch. {getChapterNumber(item)} • {formatDate(item.progress.lastRead)}
        </Text>
      )}
    </View>
  );

  const getChapterNumber = (entry: LibraryEntry): string => {
    if (!entry.progress) return '?';
    const chapter = entry.manga.chapters.find(ch => ch.id === entry.progress?.chapterId);
    return chapter?.number.toString() || '?';
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>History</Text>
        {readingHistory.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearHistory}
          >
            <Ionicons name="trash-outline" size={24} color={theme.error} />
          </TouchableOpacity>
        )}
      </View>

      {readingHistory.length === 0 ? (
        <EmptyState
          icon="📖"
          title="No reading history"
          description="Start reading some manga and your history will appear here"
        />
      ) : (
        <FlatList
          key={`history-${numColumns}`}
          data={readingHistory}
          renderItem={renderItem}
          keyExtractor={item => item.manga.id}
          numColumns={numColumns}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  clearButton: {
    padding: 8,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  itemContainer: {
    flex: 1,
  },
  progressText: {
    fontSize: 11,
    marginTop: -8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
});
