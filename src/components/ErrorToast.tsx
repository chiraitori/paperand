import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { logger, LogEntry } from '../services/loggerService';
import { useTheme } from '../context/ThemeContext';

export const ErrorToast: React.FC = () => {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [currentError, setCurrentError] = useState<LogEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const unsubscribe = logger.subscribeToErrorToasts((entry: LogEntry) => {
      // Clear any pending dismissal timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      setCurrentError(entry);

      // Animate in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: insets.top + 8,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto dismiss after 4.5s
      timerRef.current = setTimeout(() => {
        dismissToast();
      }, 4500);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [insets.top]);

  const dismissToast = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentError(null);
    });
  };

  if (!currentError) return null;

  return (
    <>
      <Animated.View
        style={[
          styles.container,
          {
            transform: [{ translateY }],
            opacity,
          },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          activeOpacity={0.9}
          style={[
            styles.toast,
            {
              backgroundColor: isDark ? '#1C1917' : '#292524',
              borderColor: '#EF4444',
            },
          ]}
          onPress={() => setModalVisible(true)}
        >
          <View style={styles.iconContainer}>
            <Ionicons name="alert-circle" size={24} color="#EF4444" />
          </View>
          <View style={styles.textContainer}>
            <View style={styles.badgeRow}>
              <View style={styles.tagBadge}>
                <Text style={styles.tagText}>{currentError.tag || 'Error'}</Text>
              </View>
              <Text style={styles.timeText}>
                {new Date(currentError.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <Text style={styles.messageText} numberOfLines={2}>
              {currentError.message}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={dismissToast}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={18} color="#A8A29E" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>

      {/* Error Details Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <Ionicons name="alert-circle" size={24} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {currentError.tag} Error
                </Text>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close-circle" size={24} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll}>
              <Text style={[styles.modalLabel, { color: theme.textSecondary }]}>MESSAGE</Text>
              <Text style={[styles.modalMessage, { color: theme.text }]}>{currentError.message}</Text>

              {currentError.details && (
                <>
                  <Text style={[styles.modalLabel, { color: theme.textSecondary, marginTop: 14 }]}>
                    DETAILS
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: theme.background }]}>
                    <Text style={[styles.codeText, { color: theme.text }]}>
                      {currentError.details}
                    </Text>
                  </View>
                </>
              )}

              {currentError.stack && (
                <>
                  <Text style={[styles.modalLabel, { color: theme.textSecondary, marginTop: 14 }]}>
                    STACK TRACE
                  </Text>
                  <View style={[styles.codeBox, { backgroundColor: theme.background }]}>
                    <Text style={[styles.codeText, { color: theme.textSecondary, fontSize: 11 }]}>
                      {currentError.stack}
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.dismissBtn, { backgroundColor: theme.primary }]}
              onPress={() => {
                setModalVisible(false);
                dismissToast();
              }}
            >
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    zIndex: 99999,
    elevation: 99999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
  },
  iconContainer: {
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  tagBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  tagText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timeText: {
    color: '#A8A29E',
    fontSize: 10,
  },
  messageText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  closeButton: {
    padding: 6,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalScroll: {
    marginBottom: 16,
  },
  modalLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  modalMessage: {
    fontSize: 15,
    lineHeight: 22,
  },
  codeBox: {
    padding: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  dismissBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  dismissBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
