import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { NativeDropdown } from './NativeDropdown';
import { Chapter } from '../types';
import { t } from '../services/i18nService';

interface ChapterListItemProps {
  chapter: Chapter;
  onPress: () => void;
  isRead?: boolean;
  isDownloaded?: boolean;
  isDownloading?: boolean;
  isQueued?: boolean;
  downloadProgress?: number;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  onMarkAllAboveAsRead?: () => void;
  onMarkAllBelowAsRead?: () => void;
  onDownload?: () => void;
}

export const ChapterListItem: React.FC<ChapterListItemProps> = ({
  chapter,
  onPress,
  isRead = false,
  isDownloaded = false,
  isDownloading = false,
  isQueued = false,
  downloadProgress = 0,
  onMarkAsRead,
  onMarkAsUnread,
  onMarkAllAboveAsRead,
  onMarkAllBelowAsRead,
  onDownload,
}) => {
  const { theme } = useTheme();

  const menuOptions = [
    ...(onDownload ? [{ label: t('chapter.download') || 'Download chapter', value: 'download' }] : []),
    ...(isRead && onMarkAsUnread
      ? [{ label: t('chapter.markAsUnread') || 'Mark as unread', value: 'markUnread' }]
      : (!isRead && onMarkAsRead
        ? [{ label: t('chapter.markAsRead') || 'Mark as read', value: 'markRead' }]
        : [])),
    ...(onMarkAllBelowAsRead ? [{ label: t('chapter.markAllBelowAsRead') || 'Mark all below as read', value: 'markAllBelow' }] : []),
    ...(onMarkAllAboveAsRead ? [{ label: t('chapter.markAllAboveAsRead') || 'Mark all above as read', value: 'markAllAbove' }] : []),
  ];

  const handleMenuSelect = (value: string) => {
    switch (value) {
      case 'download':
        onDownload?.();
        break;
      case 'markRead':
        onMarkAsRead?.();
        break;
      case 'markUnread':
        onMarkAsUnread?.();
        break;
      case 'markAllBelow':
        onMarkAllBelowAsRead?.();
        break;
      case 'markAllAbove':
        onMarkAllAboveAsRead?.();
        break;
    }
  };

  const renderContent = () => (
    <View style={styles.content}>
      <View style={styles.leftContent}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.chapterNumber,
              { color: isRead ? theme.textSecondary : theme.text },
            ]}
          >
            Chapter {chapter.number}
          </Text>
          {isQueued && (
            <Ionicons
              name="time-outline"
              size={16}
              color={theme.textSecondary}
              style={styles.downloadIcon}
            />
          )}
          {isDownloading && (
            <View style={[styles.downloadingContainer, styles.downloadIcon]}>
              <View style={[styles.progressBarBg, { backgroundColor: theme.border }]}>
                <View style={[styles.progressBarFill, { 
                  backgroundColor: theme.primary,
                  width: `${downloadProgress * 100}%`
                }]} />
              </View>
              <Text style={[styles.progressText, { color: theme.primary }]}>
                {Math.round(downloadProgress * 100)}%
              </Text>
            </View>
          )}
          {isDownloaded && !isDownloading && !isQueued && (
            <Ionicons
              name="checkmark-circle"
              size={16}
              color={theme.primary}
              style={styles.downloadIcon}
            />
          )}
          {!isDownloaded && !isDownloading && !isQueued && onDownload && (
            <Ionicons
              name="arrow-down-circle-outline"
              size={16}
              color={theme.textSecondary}
              style={styles.downloadIcon}
            />
          )}
        </View>
        {chapter.title !== `Chapter ${chapter.number}` && (
          <Text
            style={[styles.chapterTitle, { color: theme.textSecondary }]}
            numberOfLines={1}
          >
            {chapter.title}
          </Text>
        )}
      </View>
      <View style={styles.rightContent}>
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {formatDate(chapter.releaseDate)}
        </Text>
        {isRead && (
          <View style={[styles.readBadge, { backgroundColor: theme.primary }]}>
            <Text style={styles.readBadgeText}>READ</Text>
          </View>
        )}
      </View>
    </View>
  );

  // If no menu options, just render as before
  if (menuOptions.length === 0) {
    return (
      <TouchableOpacity
        style={[
          styles.container,
          { backgroundColor: theme.card, borderBottomColor: theme.border },
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {renderContent()}
      </TouchableOpacity>
    );
  }

  return (
    <NativeDropdown
      options={menuOptions}
      selectedValue=""
      onSelect={handleMenuSelect}
      title={t('chapter.options') || 'Chapter Options'}
    >
      {(openMenu) => (
        <TouchableOpacity
          style={[
            styles.container,
            { backgroundColor: theme.card, borderBottomColor: theme.border },
          ]}
          onPress={onPress}
          onLongPress={openMenu}
          delayLongPress={400}
          activeOpacity={0.7}
        >
          {renderContent()}
        </TouchableOpacity>
      )}
    </NativeDropdown>
  );
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return date.toLocaleDateString();
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leftContent: {
    flex: 1,
    marginRight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloadIcon: {
    marginLeft: 6,
  },
  downloadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarBg: {
    width: 30,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginRight: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '600',
  },
  rightContent: {
    alignItems: 'flex-end',
  },
  chapterNumber: {
    fontSize: 15,
    fontWeight: '500',
  },
  chapterTitle: {
    fontSize: 13,
    marginTop: 2,
  },
  date: {
    fontSize: 12,
  },
  readBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  readBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
