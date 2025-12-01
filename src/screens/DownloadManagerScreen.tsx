import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

interface Download {
  id: string;
  mangaTitle: string;
  chapterTitle: string;
  progress: number;
  status: 'downloading' | 'paused' | 'completed' | 'queued' | 'failed';
  size: string;
}

export const DownloadManagerScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const [downloads, setDownloads] = useState<Download[]>([
    {
      id: '1',
      mangaTitle: 'One Piece',
      chapterTitle: 'Chapter 1089',
      progress: 75,
      status: 'downloading',
      size: '12.5 MB',
    },
    {
      id: '2',
      mangaTitle: 'Jujutsu Kaisen',
      chapterTitle: 'Chapter 245',
      progress: 100,
      status: 'completed',
      size: '8.2 MB',
    },
    {
      id: '3',
      mangaTitle: 'Chainsaw Man',
      chapterTitle: 'Chapter 156',
      progress: 0,
      status: 'queued',
      size: '9.8 MB',
    },
  ]);

  const getStatusColor = (status: Download['status']) => {
    switch (status) {
      case 'downloading':
        return theme.primary;
      case 'completed':
        return theme.success;
      case 'paused':
        return '#FF9500';
      case 'failed':
        return theme.error;
      default:
        return theme.textSecondary;
    }
  };

  const getStatusIcon = (status: Download['status']) => {
    switch (status) {
      case 'downloading':
        return 'cloud-download';
      case 'completed':
        return 'checkmark-circle';
      case 'paused':
        return 'pause-circle';
      case 'failed':
        return 'alert-circle';
      default:
        return 'time';
    }
  };

  const handlePauseResume = (download: Download) => {
    setDownloads((prev) =>
      prev.map((d) =>
        d.id === download.id
          ? {
              ...d,
              status: d.status === 'paused' ? 'downloading' : 'paused',
            }
          : d
      )
    );
  };

  const handleDelete = (download: Download) => {
    Alert.alert(
      'Delete Download',
      `Delete "${download.chapterTitle}" from ${download.mangaTitle}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDownloads((prev) => prev.filter((d) => d.id !== download.id));
          },
        },
      ]
    );
  };

  const handleClearCompleted = () => {
    Alert.alert('Clear Completed', 'Remove all completed downloads?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          setDownloads((prev) => prev.filter((d) => d.status !== 'completed'));
        },
      },
    ]);
  };

  const renderDownloadItem = ({ item }: { item: Download }) => (
    <TouchableOpacity
      style={[styles.downloadItem, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
      onLongPress={() => handleDelete(item)}
    >
      <View style={styles.downloadInfo}>
        <Text style={[styles.mangaTitle, { color: theme.text }]} numberOfLines={1}>
          {item.mangaTitle}
        </Text>
        <Text style={[styles.chapterTitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {item.chapterTitle}
        </Text>
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: getStatusColor(item.status),
                  width: `${item.progress}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.sizeText, { color: theme.textSecondary }]}>{item.size}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Ionicons
          name={getStatusIcon(item.status)}
          size={24}
          color={getStatusColor(item.status)}
        />
        {(item.status === 'downloading' || item.status === 'paused') && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => handlePauseResume(item)}
          >
            <Ionicons
              name={item.status === 'paused' ? 'play' : 'pause'}
              size={20}
              color={theme.primary}
            />
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );

  const activeDownloads = downloads.filter((d) => d.status !== 'completed');
  const completedDownloads = downloads.filter((d) => d.status === 'completed');

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Settings</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Downloads</Text>
        <TouchableOpacity onPress={handleClearCompleted}>
          <Text style={[styles.clearButton, { color: theme.primary }]}>Clear</Text>
        </TouchableOpacity>
      </View>

      {downloads.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-download-outline" size={64} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            No downloads
          </Text>
        </View>
      ) : (
        <FlatList
          data={downloads}
          renderItem={renderDownloadItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            activeDownloads.length > 0 ? (
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                Active Downloads ({activeDownloads.length})
              </Text>
            ) : null
          }
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 50,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backText: {
    fontSize: 17,
    marginLeft: -4,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  clearButton: {
    fontSize: 17,
    flex: 1,
    textAlign: 'right',
    paddingRight: 8,
  },
  listContent: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  downloadItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  downloadInfo: {
    flex: 1,
  },
  mangaTitle: {
    fontSize: 17,
    fontWeight: '500',
    marginBottom: 2,
  },
  chapterTitle: {
    fontSize: 14,
    marginBottom: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginRight: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  sizeText: {
    fontSize: 12,
    minWidth: 60,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 17,
    marginTop: 16,
  },
});
