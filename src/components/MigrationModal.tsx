import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useLibrary } from '../context/LibraryContext';
import {
  getInstalledExtensions,
  searchManga,
  getMangaDetails,
  getChapters,
  InstalledExtension,
  SourceManga,
} from '../services/sourceService';
import { Manga, Chapter } from '../types';
import { t } from '../services/i18nService';

interface MigrationModalProps {
  visible: boolean;
  onClose: () => void;
  currentManga: Manga;
  currentSourceId: string;
  onMigrated: (newMangaId: string, newSourceId: string) => void;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  visible,
  onClose,
  currentManga,
  currentSourceId,
  onMigrated,
}) => {
  const { theme } = useTheme();
  const { migrateManga } = useLibrary();

  const [query, setQuery] = useState(currentManga.title);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [candidates, setCandidates] = useState<{ manga: SourceManga; sourceName: string }[]>([]);
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);

  useEffect(() => {
    if (visible) {
      setQuery(currentManga.title);
      loadExtensionsAndSearch(currentManga.title);
    }
  }, [visible, currentManga.title]);

  const loadExtensionsAndSearch = async (searchQuery: string) => {
    setLoading(true);
    setCandidates([]);
    try {
      const allExts = await getInstalledExtensions();
      const otherExts = allExts.filter(e => e.id !== currentSourceId);
      setExtensions(allExts);

      if (otherExts.length === 0) {
        setLoading(false);
        return;
      }

      const results = await Promise.all(
        otherExts.map(async ext => {
          try {
            const res = await searchManga(ext.id, searchQuery);
            return (res.results || []).map(m => ({
              manga: m,
              sourceName: ext.name,
            }));
          } catch (e) {
            return [];
          }
        })
      );

      const flat = results.flat();
      setCandidates(flat);
    } catch (e) {
      console.warn('Migration search error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCandidate = async (candidate: { manga: SourceManga; sourceName: string }) => {
    setMigrating(true);
    try {
      const targetSourceId = candidate.manga.extensionId;
      const targetMangaId = candidate.manga.mangaId || candidate.manga.id;

      // Fetch full manga details and chapters from target source
      const [mangaDetails, chaptersData] = await Promise.all([
        getMangaDetails(targetSourceId, targetMangaId).catch(() => null),
        getChapters(targetSourceId, targetMangaId).catch(() => []),
      ]);

      const mappedChapters: Chapter[] = chaptersData.map(ch => ({
        id: ch.id,
        mangaId: targetMangaId,
        number: ch.chapNum,
        title: ch.name || `Chapter ${ch.chapNum}`,
        pages: [],
        releaseDate: ch.time || new Date().toISOString(),
        isRead: false,
      }));

      const newManga: Manga = {
        id: targetMangaId,
        title: mangaDetails?.titles?.[0] || candidate.manga.title,
        author: mangaDetails?.author || currentManga.author || '',
        artist: mangaDetails?.artist || currentManga.artist,
        description: mangaDetails?.desc || currentManga.description || '',
        coverImage: mangaDetails?.image || candidate.manga.image || currentManga.coverImage,
        genres: mangaDetails?.tags?.map((t: any) => t.label) || currentManga.genres || [],
        status: mangaDetails?.status?.toLowerCase() || currentManga.status,
        chapters: mappedChapters,
        lastUpdated: new Date().toISOString(),
        source: targetSourceId,
      };

      await migrateManga(currentManga.id, newManga);

      onClose();
      onMigrated(targetMangaId, targetSourceId);
    } catch (e: any) {
      console.error('Migration failed:', e);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.container, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleInfo}>
              <Text style={[styles.title, { color: theme.text }]}>Migrate Source</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                Switch source and preserve reading progress
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={[styles.searchBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Ionicons name="search" size={18} color={theme.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => loadExtensionsAndSearch(query)}
              returnKeyType="search"
              placeholder="Search manga title"
              placeholderTextColor={theme.textSecondary}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => loadExtensionsAndSearch(query)}>
                <Ionicons name="arrow-forward-circle" size={22} color={theme.primary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Candidate List */}
          {loading || migrating ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                {migrating ? 'Migrating chapters & bookmarks...' : 'Searching other sources...'}
              </Text>
            </View>
          ) : candidates.length === 0 ? (
            <View style={styles.centerContainer}>
              <Ionicons name="git-merge-outline" size={48} color={theme.textSecondary} />
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                No alternative matches found in your installed extensions.
              </Text>
            </View>
          ) : (
            <FlatList
              data={candidates}
              keyExtractor={(item, idx) => `${item.manga.extensionId}-${item.manga.id}-${idx}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.candidateRow, { borderBottomColor: theme.border }]}
                  onPress={() => handleSelectCandidate(item)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: item.manga.image }}
                    style={styles.candidateCover}
                    resizeMode="cover"
                  />
                  <View style={styles.candidateInfo}>
                    <Text style={[styles.candidateTitle, { color: theme.text }]} numberOfLines={2}>
                      {item.manga.title}
                    </Text>
                    <View style={[styles.sourceBadge, { backgroundColor: `${theme.primary}20` }]}>
                      <Text style={[styles.sourceBadgeText, { color: theme.primary }]}>
                        {item.sourceName}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    height: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleInfo: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  candidateCover: {
    width: 48,
    height: 70,
    borderRadius: 6,
  },
  candidateInfo: {
    flex: 1,
  },
  candidateTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  sourceBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
