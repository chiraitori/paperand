import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { LibraryUpdateResult } from '../types';
import { t } from '../services/i18nService';

interface LibraryUpdaterModalProps {
  visible: boolean;
  onClose: () => void;
  isUpdating: boolean;
  currentProgress: { current: number; total: number; currentTitle: string };
  result: LibraryUpdateResult | null;
  onStartUpdate: () => void;
}

export const LibraryUpdaterModal: React.FC<LibraryUpdaterModalProps> = ({
  visible,
  onClose,
  isUpdating,
  currentProgress,
  result,
  onStartUpdate,
}) => {
  const { theme } = useTheme();

  const progressPercent = currentProgress.total > 0
    ? Math.min(100, Math.round((currentProgress.current / currentProgress.total) * 100))
    : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isUpdating ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View style={[styles.iconBadge, { backgroundColor: `${theme.primary}20` }]}>
                <Ionicons
                  name={isUpdating ? "cloud-download" : (result?.newChaptersCount ? "cloud-done" : "cloud-outline")}
                  size={24}
                  color={theme.primary}
                />
              </View>
              <View style={styles.titleTextContainer}>
                <Text style={[styles.title, { color: theme.text }]}>
                  {t('libraryUpdater.title') || 'Library Updater'}
                </Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {isUpdating
                    ? (t('libraryUpdater.checking') || 'Checking for updates...')
                    : (result ? (t('libraryUpdater.completed') || 'Update Complete') : 'Check chapter updates')}
                </Text>
              </View>
            </View>
            {!isUpdating && (
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={theme.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Updating State */}
          {isUpdating && (
            <View style={styles.progressContainer}>
              <View style={[styles.progressBarBackground, { backgroundColor: `${theme.primary}20` }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    { backgroundColor: theme.primary, width: `${progressPercent}%` }
                  ]}
                />
              </View>
              <View style={styles.progressTextRow}>
                <Text style={[styles.progressCurrentText, { color: theme.textSecondary }]} numberOfLines={1}>
                  {currentProgress.currentTitle || 'Checking library...'}
                </Text>
                <Text style={[styles.progressPercentText, { color: theme.primary }]}>
                  {currentProgress.current} / {currentProgress.total}
                </Text>
              </View>
              <ActivityIndicator size="small" color={theme.primary} style={{ marginTop: 16 }} />
            </View>
          )}

          {/* Completed State */}
          {!isUpdating && result && (
            <View style={styles.resultContainer}>
              <View style={[styles.summaryBadge, { backgroundColor: result.newChaptersCount > 0 ? `${theme.success}15` : `${theme.primary}15` }]}>
                <Ionicons
                  name={result.newChaptersCount > 0 ? "sparkles" : "checkmark-circle"}
                  size={20}
                  color={result.newChaptersCount > 0 ? theme.success : theme.primary}
                />
                <Text style={[styles.summaryText, { color: result.newChaptersCount > 0 ? theme.success : theme.text }]}>
                  {result.newChaptersCount > 0
                    ? `${result.newChaptersCount} new chapters across ${result.updatedMangaCount} titles`
                    : (t('libraryUpdater.upToDate') || 'All manga are up to date')}
                </Text>
              </View>

              {result.details.length > 0 && (
                <ScrollView style={styles.detailsList} showsVerticalScrollIndicator={false}>
                  {result.details.map((item, idx) => (
                    <View
                      key={item.mangaId || idx}
                      style={[styles.detailItem, { borderBottomColor: theme.border }]}
                    >
                      <View style={styles.detailInfo}>
                        <Text style={[styles.detailTitle, { color: theme.text }]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.latestChapter && (
                          <Text style={[styles.detailLatest, { color: theme.textSecondary }]} numberOfLines={1}>
                            Latest: {item.latestChapter}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.newBadge, { backgroundColor: theme.primary }]}>
                        <Text style={styles.newBadgeText}>+{item.newChapters}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actionsRow}>
            {!isUpdating && (
              <>
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton, { borderColor: theme.border }]}
                  onPress={onClose}
                >
                  <Text style={[styles.buttonText, { color: theme.text }]}>
                    {t('common.done') || 'Done'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton, { backgroundColor: theme.primary }]}
                  onPress={onStartUpdate}
                >
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={[styles.buttonText, { color: '#fff' }]}>
                    {result ? 'Check Again' : (t('libraryUpdater.startUpdate') || 'Check Updates')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleTextContainer: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  progressContainer: {
    paddingVertical: 12,
  },
  progressBarBackground: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    gap: 10,
  },
  progressCurrentText: {
    fontSize: 13,
    flex: 1,
  },
  progressPercentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resultContainer: {
    paddingVertical: 8,
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 10,
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  detailsList: {
    maxHeight: 220,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  detailInfo: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailLatest: {
    fontSize: 12,
    marginTop: 2,
  },
  newBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 6,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  primaryButton: {},
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
