import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
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
  DeviceOrientationSetting,
} from '../services/readerSettingsService';

export type ReaderSettingsScope = 'global' | 'manga';

interface ReaderSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  settings: ReaderSettingsValues;
  onUpdateSetting: <K extends keyof ReaderSettingsValues>(
    key: K,
    value: ReaderSettingsValues[K]
  ) => void;
  scope?: ReaderSettingsScope;
  onScopeChange?: (scope: ReaderSettingsScope) => void;
  isCustom?: boolean;
  onApplyGlobally?: () => void;
  onResetToGlobal?: () => void;
  mangaTitle?: string;
}

const SHEET_BG = '#0C0C0D';
const CARD_BG = '#1C1C1E';
const SEGMENT_ACTIVE = '#636366';
const DIVIDER = '#38383A';
const MUTED = '#8E8E93';
const ACCENT = '#FA233B';
const SWITCH_GREEN = '#34C759';

const tr = (key: string, fallback: string): string => {
  const value = t(key);
  return !value || value === key ? fallback : value;
};

export const ReaderSettingsModal: React.FC<ReaderSettingsModalProps> = ({
  visible,
  onClose,
  settings,
  onUpdateSetting,
  scope = 'global',
  onScopeChange,
  isCustom = false,
  onApplyGlobally,
  onResetToGlobal,
}) => {
  const { theme } = useTheme();
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const handleResetToGlobal = () => {
    Alert.alert(
      tr('reader.resetToGlobal', 'Reset to Global'),
      tr(
        'reader.resetConfirm',
        'All custom reader settings for this title will be reset to global defaults. Continue?'
      ),
      [
        { text: tr('common.cancel', 'Cancel'), style: 'cancel' },
        {
          text: tr('reader.resetToGlobal', 'Reset'),
          style: 'destructive',
          onPress: () => onResetToGlobal?.(),
        },
      ]
    );
  };

  const handleApplyGlobally = () => {
    Alert.alert(
      tr('reader.applyGlobally', 'Apply Globally'),
      'Set current reader settings as the default for all titles?',
      [
        { text: tr('common.cancel', 'Cancel'), style: 'cancel' },
        { text: tr('common.ok', 'OK'), onPress: () => onApplyGlobally?.() },
      ]
    );
  };

  const renderSegment = <T extends string>(
    options: { label: string; value: T }[],
    selectedValue: T,
    onSelect: (val: T) => void
  ) => (
    <View style={styles.segmentContainer}>
      {options.map((opt) => {
        const isSelected = selectedValue === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segmentItem, isSelected && styles.segmentItemActive]}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.segmentText, isSelected && styles.segmentTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // iOS style "label ........ value ^" row that expands into the available options
  const renderPickerRow = <T extends string>(
    id: string,
    label: string,
    options: { label: string; value: T }[],
    selectedValue: T,
    onSelect: (val: T) => void,
    first = false
  ) => {
    const isOpen = openPicker === id;
    const current = options.find((o) => o.value === selectedValue);
    return (
      <View>
        <TouchableOpacity
          style={[styles.row, !first && styles.dividerRow]}
          activeOpacity={0.6}
          onPress={() => setOpenPicker(isOpen ? null : id)}
        >
          <Text style={styles.rowLabel}>{label}</Text>
          <View style={styles.pickerValueWrap}>
            <Text style={styles.pickerValue} numberOfLines={1}>
              {current?.label}
            </Text>
            <Ionicons name="chevron-expand" size={16} color={ACCENT} />
          </View>
        </TouchableOpacity>
        {isOpen &&
          options.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.row, styles.dividerRow, styles.optionRow]}
              activeOpacity={0.6}
              onPress={() => {
                onSelect(opt.value);
                setOpenPicker(null);
              }}
            >
              <Text style={[styles.rowLabel, { color: opt.value === selectedValue ? ACCENT : '#FFFFFF' }]}>
                {opt.label}
              </Text>
              {opt.value === selectedValue && <Ionicons name="checkmark" size={18} color={ACCENT} />}
            </TouchableOpacity>
          ))}
      </View>
    );
  };

  const renderSwitchRow = (
    label: string,
    value: boolean,
    onChange: (val: boolean) => void,
    subtitle?: string,
    first = false
  ) => (
    <View style={[styles.row, !first && styles.dividerRow]}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#3A3A3C', true: SWITCH_GREEN }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#3A3A3C"
      />
    </View>
  );

  const orientationOptions: { label: string; value: DeviceOrientationSetting }[] = [
    { label: tr('reader.both', 'Both'), value: 'both' },
    { label: tr('reader.portrait', 'Portrait'), value: 'portrait' },
    { label: tr('reader.landscape', 'Landscape'), value: 'landscape' },
  ];

  const amount = settings.pillarboxAmount ?? 0;
  const setAmount = (next: number) => {
    const clamped = Math.max(0, Math.min(40, next));
    onUpdateSetting('pillarboxAmount', clamped);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.doneButtonContainer} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.doneButton}>{tr('common.done', 'Done')}</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollViewContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>{tr('reader.settingsTitle', 'Reader Settings')}</Text>

            {/* Settings scope */}
            <Text style={styles.sectionHeader}>{tr('reader.settingsScope', 'Settings Scope')}</Text>
            {renderSegment<ReaderSettingsScope>(
              [
                { label: tr('reader.scopeGlobal', 'Global'), value: 'global' },
                { label: tr('reader.scopeManga', 'Manga'), value: 'manga' },
              ],
              scope,
              (val) => onScopeChange?.(val)
            )}

            {/* Reader type */}
            <Text style={styles.sectionHeader}>{tr('reader.readerType', 'Reader Type')}</Text>
            {renderSegment<ReaderMode>(
              [
                { label: tr('reader.vertical', 'Vertical'), value: 'longStrip' },
                { label: tr('reader.horizontal', 'Horizontal'), value: 'horizontal' },
              ],
              settings.readerMode,
              (val) => onUpdateSetting('readerMode', val)
            )}

            {settings.readerMode === 'horizontal' ? (
              <>
                <Text style={styles.sectionHeader}>
                  {tr('reader.horizontalSettings', 'Horizontal Reader Settings')}
                </Text>
                <View style={styles.card}>
                  {renderPickerRow<PagedDisplayMode>(
                    'displayMode',
                    tr('reader.displayMode', 'Display Mode'),
                    [
                      { label: tr('reader.singlePage', 'Single'), value: 'singlePage' },
                      { label: tr('reader.doublePage', 'Double'), value: 'doublePage' },
                      { label: tr('reader.automatic', 'Automatic'), value: 'automatic' },
                    ],
                    settings.pagedDisplayMode,
                    (val) => onUpdateSetting('pagedDisplayMode', val),
                    true
                  )}
                  {renderSwitchRow(
                    tr('reader.alwaysSeparateFirstPage', 'Always Separate First Page'),
                    settings.markFirstPageAsSingle,
                    (val) => onUpdateSetting('markFirstPageAsSingle', val)
                  )}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sectionHeader}>
                  {tr('reader.verticalSettings', 'Vertical Reader Settings')}
                </Text>
                <Text style={[styles.sectionHeader, { marginTop: 8 }]}>
                  {tr('reader.pillarboxSettings', 'Pillarbox Settings')}
                </Text>
                <View style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{tr('reader.pillarboxAmount', 'Amount')}</Text>
                    <View style={styles.stepperWrap}>
                      <Text style={styles.stepperValueText}>{amount}</Text>
                      <View style={styles.stepper}>
                        <TouchableOpacity
                          style={styles.stepperButton}
                          onPress={() => setAmount(amount - 2)}
                          activeOpacity={0.6}
                        >
                          <Ionicons name="remove" size={18} color={amount <= 0 ? '#555' : '#FFFFFF'} />
                        </TouchableOpacity>
                        <View style={styles.stepperDivider} />
                        <TouchableOpacity
                          style={styles.stepperButton}
                          onPress={() => setAmount(amount + 2)}
                          activeOpacity={0.6}
                        >
                          <Ionicons name="add" size={18} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                  {renderPickerRow<DeviceOrientationSetting>(
                    'pillarboxOrientation',
                    tr('reader.deviceOrientation', 'Device Orientation'),
                    orientationOptions,
                    settings.pillarboxOrientation,
                    (val) => onUpdateSetting('pillarboxOrientation', val)
                  )}
                </View>
              </>
            )}

            {/* General settings */}
            <Text style={styles.sectionHeader}>{tr('reader.generalSettings', 'General Settings')}</Text>
            <View style={styles.card}>
              {renderPickerRow<ReaderDirection>(
                'direction',
                tr('reader.readingDirection', 'Reader Direction'),
                [
                  { label: tr('reader.rtl', 'Right to Left (Manga)'), value: 'rightToLeft' },
                  { label: tr('reader.ltr', 'Left to Right (Comics)'), value: 'leftToRight' },
                ],
                settings.readerDirection,
                (val) => onUpdateSetting('readerDirection', val),
                true
              )}
              {renderSwitchRow(
                tr('reader.downsamplePages', 'Downsample Pages'),
                settings.downsamplePages,
                (val) => onUpdateSetting('downsamplePages', val)
              )}
              {renderSwitchRow(
                tr('reader.pagePadding', 'Page Padding'),
                settings.pagePadding,
                (val) => onUpdateSetting('pagePadding', val)
              )}
              {renderSwitchRow(
                tr('reader.lockRotation', 'Lock Rotation'),
                settings.rotationLocked,
                (val) => onUpdateSetting('rotationLocked', val)
              )}
              {renderSwitchRow(
                tr('reader.enableTapNavigation', 'Enable Tap Navigation'),
                settings.tapSidesToNavgiate,
                (val) => onUpdateSetting('tapSidesToNavgiate', val)
              )}
              {renderSwitchRow(
                tr('reader.enablePageSaving', 'Enable Page Saving'),
                settings.longPressToSaveImageEnabled,
                (val) => onUpdateSetting('longPressToSaveImageEnabled', val)
              )}
              {renderPickerRow<ChapterBackground>(
                'background',
                tr('reader.chapterBackground', 'Chapter Background'),
                [
                  { label: 'Theme', value: 'theme' },
                  { label: 'Black', value: 'black' },
                  { label: 'Dark', value: 'dark' },
                  { label: 'White', value: 'white' },
                ],
                settings.chapterBackgroundColor,
                (val) => onUpdateSetting('chapterBackgroundColor', val)
              )}
            </View>

            {/* Action buttons settings */}
            <Text style={styles.sectionHeader}>{tr('reader.actionButtonsSettings', 'Action Buttons Settings')}</Text>
            <View style={styles.card}>
              {renderPickerRow<string>(
                'chevronButtonLocation',
                tr('reader.chevronButtonLocation', 'Chevron Button Location'),
                [
                  { label: tr('reader.right', 'Right'), value: 'right' },
                  { label: tr('reader.left', 'Left'), value: 'left' },
                ],
                settings.chapterChangeArrows === 'left' ? 'left' : 'right',
                (val) => onUpdateSetting('chapterChangeArrows', val as any),
                true
              )}
              {renderPickerRow<string>(
                'settingsButtonLocation',
                tr('reader.settingsButtonLocation', 'Settings Button Location'),
                [
                  { label: tr('reader.right', 'Right'), value: 'right' },
                  { label: tr('reader.left', 'Left'), value: 'left' },
                ],
                settings.settingButtonLocation,
                (val) => onUpdateSetting('settingButtonLocation', val as any)
              )}
            </View>

            {/* Apply Globally Button Card */}
            <TouchableOpacity
              style={styles.applyButtonCard}
              onPress={handleApplyGlobally}
              activeOpacity={0.7}
            >
              <Text style={styles.applyButtonCardText}>{tr('reader.applyGlobally', 'Apply Globally')}</Text>
            </TouchableOpacity>

            {scope === 'manga' && isCustom ? (
              <TouchableOpacity
                style={[styles.applyButtonCard, { marginTop: 12 }]}
                onPress={handleResetToGlobal}
                activeOpacity={0.7}
              >
                <Text style={[styles.applyButtonCardText, { color: '#FF453A' }]}>
                  {tr('reader.resetToGlobal', 'Reset to Global')}
                </Text>
              </TouchableOpacity>
            ) : null}

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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: '88%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
  doneButtonContainer: {
    alignItems: 'flex-end',
  },
  doneButton: {
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  scrollView: {
    paddingHorizontal: 16,
  },
  scrollViewContent: {
    paddingBottom: Platform.OS === 'android' ? 30 : 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '500',
    color: MUTED,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingVertical: 8,
  },
  optionRow: {
    paddingLeft: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  dividerRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER,
  },
  rowLabel: {
    fontSize: 17,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  rowSubtitle: {
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
  },
  pickerValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    marginLeft: 12,
  },
  pickerValue: {
    fontSize: 16,
    color: MUTED,
    flexShrink: 1,
  },
  stepperWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepperValueText: {
    fontSize: 17,
    fontWeight: '400',
    color: '#FFFFFF',
    marginRight: 16,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepperButton: {
    width: 46,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: '#555',
  },
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 2,
    backgroundColor: CARD_BG,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentItemActive: {
    backgroundColor: SEGMENT_ACTIVE,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  segmentTextActive: {
    fontWeight: '600',
  },
  applyButtonCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  applyButtonCardText: {
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 20,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  applyButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
