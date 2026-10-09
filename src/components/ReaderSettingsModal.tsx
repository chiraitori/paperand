import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { t } from '../services/i18nService';
import {
  ReaderSettingsValues,
  ReaderMode,
  ReaderDirection,
  PagedDisplayMode,
  ChapterBackground,
  SettingButtonLocation,
  ChapterChangeArrowLocation,
  DeviceOrientationSetting,
} from '../services/readerSettingsService';

interface ReaderSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  settings: ReaderSettingsValues;
  onUpdateSetting: <K extends keyof ReaderSettingsValues>(
    key: K,
    value: ReaderSettingsValues[K]
  ) => void;
  isCustom?: boolean;
  onApplyGlobally?: () => void;
  onResetToGlobal?: () => void;
  mangaTitle?: string;
}

export const ReaderSettingsModal: React.FC<ReaderSettingsModalProps> = ({
  visible,
  onClose,
  settings,
  onUpdateSetting,
  isCustom = false,
  onApplyGlobally,
  onResetToGlobal,
  mangaTitle,
}) => {
  const { theme } = useTheme();

  const handleResetToGlobal = () => {
    Alert.alert(
      t('reader.resetToGlobal') || 'Reset to Global',
      t('reader.resetConfirm') || 'All custom reader settings for this title will be reset to global defaults. Continue?',
      [
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('reader.resetToGlobal') || 'Reset',
          style: 'destructive',
          onPress: () => {
            onResetToGlobal?.();
          },
        },
      ]
    );
  };

  const handleApplyGlobally = () => {
    Alert.alert(
      t('reader.applyGlobally') || 'Apply Globally',
      'Set current reader settings as the default for all titles?',
      [
        { text: t('common.cancel') || 'Cancel', style: 'cancel' },
        {
          text: t('common.ok') || 'OK',
          onPress: () => {
            onApplyGlobally?.();
          },
        },
      ]
    );
  };

  const renderSegment = <T extends string>(
    options: { label: string; value: T }[],
    selectedValue: T,
    onSelect: (val: T) => void
  ) => (
    <View style={[styles.segmentContainer, { backgroundColor: '#2C2C2E' }]}>
      {options.map((opt) => {
        const isSelected = selectedValue === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.segmentItem,
              isSelected && { backgroundColor: theme.primary },
            ]}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.segmentText,
                isSelected ? styles.segmentTextActive : { color: '#8E8E93' },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.modalContent, { backgroundColor: '#1C1C1E' }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ width: 60 }} />
            <Text style={styles.title}>{t('reader.settingsTitle') || 'Reader Settings'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.doneButtonContainer}>
              <Text style={[styles.doneButton, { color: theme.primary }]}>
                {t('common.done') || 'Done'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {/* Custom Settings Indicator / Controls */}
            {isCustom && (
              <View style={[styles.scopeBanner, { backgroundColor: '#2C2C2E', borderColor: theme.primary }]}>
                <View style={styles.scopeBannerLeft}>
                  <Ionicons name="options-outline" size={20} color={theme.primary} />
                  <Text style={styles.scopeBannerText}>
                    Custom settings for this manga
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.scopeActionButton, { borderColor: theme.error }]}
                  onPress={handleResetToGlobal}
                >
                  <Text style={[styles.scopeActionButtonText, { color: theme.error }]}>
                    {t('reader.resetToGlobal') || 'Reset'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Reader Mode (Horizontal vs Vertical) */}
            <Text style={styles.sectionHeader}>{t('reader.readerType') || 'READER TYPE'}</Text>
            {renderSegment<ReaderMode>(
              [
                { label: t('reader.horizontal') || 'Horizontal', value: 'horizontal' },
                { label: t('reader.vertical') || 'Vertical (Long Strip)', value: 'longStrip' },
              ],
              settings.readerMode,
              (val) => onUpdateSetting('readerMode', val)
            )}

            {/* Horizontal Reader Settings (Only when in horizontal mode) */}
            {settings.readerMode === 'horizontal' && (
              <>
                <Text style={styles.sectionHeader}>
                  {t('reader.horizontalSettings') || 'HORIZONTAL READER SETTINGS'}
                </Text>
                <View style={[styles.card, { backgroundColor: '#2C2C2E' }]}>
                  {/* Display Mode (Single / Double / Auto) */}
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{t('reader.displayMode') || 'Display Mode'}</Text>
                  </View>
                  <View style={{ marginBottom: 12 }}>
                    {renderSegment<PagedDisplayMode>(
                      [
                        { label: t('reader.singlePage') || 'Single', value: 'singlePage' },
                        { label: t('reader.doublePage') || 'Double', value: 'doublePage' },
                        { label: t('reader.automatic') || 'Automatic', value: 'automatic' },
                      ],
                      settings.pagedDisplayMode,
                      (val) => onUpdateSetting('pagedDisplayMode', val)
                    )}
                  </View>

                  {/* Always Separate First Page */}
                  <View style={[styles.row, styles.dividerRow]}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={styles.rowLabel}>
                        {t('reader.alwaysSeparateFirstPage') || 'Always Separate First Page'}
                      </Text>
                      <Text style={styles.rowSubtitle}>
                        {t('reader.alwaysSeparateFirstPageHint') || 'Displays cover page alone in two-page spread'}
                      </Text>
                    </View>
                    <Switch
                      value={settings.markFirstPageAsSingle}
                      onValueChange={(val) => onUpdateSetting('markFirstPageAsSingle', val)}
                      trackColor={{ false: '#3A3A3C', true: theme.primary }}
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  {/* Reading Direction */}
                  <View style={[styles.row, styles.dividerRow]}>
                    <Text style={styles.rowLabel}>
                      {t('reader.readingDirection') || 'Reader Direction'}
                    </Text>
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    {renderSegment<ReaderDirection>(
                      [
                        { label: t('reader.rtl') || 'Right to Left (Manga)', value: 'rightToLeft' },
                        { label: t('reader.ltr') || 'Left to Right (Comics)', value: 'leftToRight' },
                      ],
                      settings.readerDirection,
                      (val) => onUpdateSetting('readerDirection', val)
                    )}
                  </View>
                </View>
              </>
            )}

            {/* General Settings */}
            <Text style={styles.sectionHeader}>
              {t('reader.generalSettings') || 'GENERAL SETTINGS'}
            </Text>
            <View style={[styles.card, { backgroundColor: '#2C2C2E' }]}>
              {/* Orientation Setting */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>
                  {t('reader.deviceOrientation') || 'Device Orientation'}
                </Text>
              </View>
              <View style={{ marginBottom: 12 }}>
                {renderSegment<DeviceOrientationSetting>(
                  [
                    { label: t('reader.both') || 'Free', value: 'both' },
                    { label: t('reader.portrait') || 'Portrait', value: 'portrait' },
                    { label: t('reader.landscape') || 'Landscape', value: 'landscape' },
                  ],
                  settings.pillarboxOrientation,
                  (val) => onUpdateSetting('pillarboxOrientation', val)
                )}
              </View>

              {/* Lock Rotation */}
              <View style={[styles.row, styles.dividerRow]}>
                <Text style={styles.rowLabel}>{t('reader.lockRotation') || 'Lock Rotation'}</Text>
                <Switch
                  value={settings.rotationLocked}
                  onValueChange={(val) => onUpdateSetting('rotationLocked', val)}
                  trackColor={{ false: '#3A3A3C', true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Page Padding */}
              <View style={[styles.row, styles.dividerRow]}>
                <Text style={styles.rowLabel}>{t('reader.pagePadding') || 'Page Padding'}</Text>
                <Switch
                  value={settings.pagePadding}
                  onValueChange={(val) => onUpdateSetting('pagePadding', val)}
                  trackColor={{ false: '#3A3A3C', true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Tap to Navigate */}
              <View style={[styles.row, styles.dividerRow]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.rowLabel}>
                    {t('reader.enableTapNavigation') || 'Enable Tap Navigation'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    Tap sides to turn pages, center to toggle controls
                  </Text>
                </View>
                <Switch
                  value={settings.tapSidesToNavgiate}
                  onValueChange={(val) => onUpdateSetting('tapSidesToNavgiate', val)}
                  trackColor={{ false: '#3A3A3C', true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Page Saving */}
              <View style={[styles.row, styles.dividerRow]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.rowLabel}>
                    {t('reader.enablePageSaving') || 'Enable Page Saving'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    Long press any page to save or share
                  </Text>
                </View>
                <Switch
                  value={settings.longPressToSaveImageEnabled}
                  onValueChange={(val) => onUpdateSetting('longPressToSaveImageEnabled', val)}
                  trackColor={{ false: '#3A3A3C', true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Downsample Pages */}
              <View style={[styles.row, styles.dividerRow]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.rowLabel}>
                    {t('reader.downsamplePages') || 'Downsample Pages'}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    Reduces memory usage for large high-res pages
                  </Text>
                </View>
                <Switch
                  value={settings.downsamplePages}
                  onValueChange={(val) => onUpdateSetting('downsamplePages', val)}
                  trackColor={{ false: '#3A3A3C', true: theme.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Chapter Background */}
              <View style={[styles.row, styles.dividerRow]}>
                <Text style={styles.rowLabel}>
                  {t('reader.chapterBackground') || 'Chapter Background'}
                </Text>
              </View>
              <View style={{ marginBottom: 8 }}>
                {renderSegment<ChapterBackground>(
                  [
                    { label: 'Black', value: 'black' },
                    { label: 'Dark', value: 'dark' },
                    { label: 'Theme', value: 'theme' },
                    { label: 'White', value: 'white' },
                  ],
                  settings.chapterBackgroundColor,
                  (val) => onUpdateSetting('chapterBackgroundColor', val)
                )}
              </View>
            </View>

            {/* Action Buttons Settings */}
            <Text style={styles.sectionHeader}>
              {t('reader.actionButtonsSettings') || 'ACTION BUTTONS SETTINGS'}
            </Text>
            <View style={[styles.card, { backgroundColor: '#2C2C2E' }]}>
              {/* Settings Button Location */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>
                  {t('reader.settingsButtonLocation') || 'Settings Button Location'}
                </Text>
              </View>
              <View style={{ marginBottom: 12 }}>
                {renderSegment<SettingButtonLocation>(
                  [
                    { label: t('reader.left') || 'Left', value: 'left' },
                    { label: t('reader.right') || 'Right', value: 'right' },
                  ],
                  settings.settingButtonLocation,
                  (val) => onUpdateSetting('settingButtonLocation', val)
                )}
              </View>

              {/* Chevron Buttons Location */}
              <View style={[styles.row, styles.dividerRow]}>
                <Text style={styles.rowLabel}>
                  {t('reader.chevronButtonLocation') || 'Chevron Button Location'}
                </Text>
              </View>
              <View style={{ marginBottom: 8 }}>
                {renderSegment<ChapterChangeArrowLocation>(
                  [
                    { label: t('reader.left') || 'Left', value: 'left' },
                    { label: t('reader.middle') || 'Middle', value: 'middle' },
                    { label: t('reader.right') || 'Right', value: 'right' },
                  ],
                  settings.chapterChangeArrows,
                  (val) => onUpdateSetting('chapterChangeArrows', val)
                )}
              </View>
            </View>

            {/* Apply Globally Button */}
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: theme.primary }]}
              onPress={handleApplyGlobally}
              activeOpacity={0.8}
            >
              <Ionicons name="globe-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.applyButtonText}>
                {t('reader.applyGlobally') || 'Apply Globally'}
              </Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#38383A',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  doneButtonContainer: {
    width: 60,
    alignItems: 'flex-end',
  },
  doneButton: {
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  scopeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  scopeBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  scopeBannerText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 8,
  },
  scopeActionButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  scopeActionButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  dividerRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#38383A',
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  rowSubtitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 20,
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
