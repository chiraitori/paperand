import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../context/ThemeContext';
import { MangaCard, LoadingIndicator } from '../components';
import { getMangaList, searchManga, getGenres } from '../data/mockData';
import { Manga, RootStackParamList } from '../types';

type BrowseScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const BrowseScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<BrowseScreenNavigationProp>();
  const [mangaList, setMangaList] = useState<Manga[]>([]);
  const [filteredList, setFilteredList] = useState<Manga[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [genres, setGenres] = useState<string[]>([]);

  useEffect(() => {
    loadManga();
    setGenres(getGenres());
  }, []);

  useEffect(() => {
    filterManga();
  }, [searchQuery, selectedGenre, mangaList]);

  const loadManga = async () => {
    try {
      setLoading(true);
      const data = await getMangaList();
      setMangaList(data);
      setFilteredList(data);
    } catch (error) {
      console.error('Failed to load manga:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterManga = useCallback(async () => {
    let result = mangaList;

    if (searchQuery.trim()) {
      result = await searchManga(searchQuery);
    }

    if (selectedGenre) {
      result = result.filter(manga =>
        manga.genres.includes(selectedGenre)
      );
    }

    setFilteredList(result);
  }, [searchQuery, selectedGenre, mangaList]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadManga();
    setRefreshing(false);
  }, []);

  const navigateToManga = (mangaId: string) => {
    navigation.navigate('MangaDetail', { mangaId });
  };

  const renderGenreFilter = () => (
    <FlatList
      horizontal
      data={['All', ...genres]}
      keyExtractor={item => item}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.genreList}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[
            styles.genreChip,
            (item === 'All' && !selectedGenre) || selectedGenre === item
              ? { backgroundColor: theme.primary }
              : { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 },
          ]}
          onPress={() => setSelectedGenre(item === 'All' ? null : item)}
        >
          <Text
            style={[
              styles.genreText,
              {
                color:
                  (item === 'All' && !selectedGenre) || selectedGenre === item
                    ? '#FFFFFF'
                    : theme.text,
              },
            ]}
          >
            {item}
          </Text>
        </TouchableOpacity>
      )}
    />
  );

  const renderItem = ({ item }: { item: Manga }) => (
    <MangaCard manga={item} onPress={() => navigateToManga(item.id)} />
  );

  if (loading) {
    return <LoadingIndicator fullScreen message="Loading manga..." />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Browse</Text>
      </View>

      <View style={styles.searchContainer}>
        <View style={[styles.searchBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search manga..."
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={[styles.clearButton, { color: theme.textSecondary }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {renderGenreFilter()}

      <FlatList
        data={filteredList}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        numColumns={3}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No manga found
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  clearButton: {
    fontSize: 16,
    padding: 4,
  },
  genreList: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  genreChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  genreText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  row: {
    justifyContent: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
  },
});
