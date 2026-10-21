import React, { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import {
  ReleaseInfo,
  downloadApk,
  installApk,
  skipVersion,
  formatBytes,
  getApkDownloadState,
  pauseApkDownload,
} from '../services/updateService';

interface UpdateModalProps {
  visible: boolean;
  currentVersion: string;
  releaseInfo: ReleaseInfo;
  onClose: () => void;
  onSkip: () => void;
}

type DownloadState = 'idle' | 'downloading' | 'paused' | 'downloaded' | 'installing' | 'error';

export const UpdateModal: React.FC<UpdateModalProps> = ({
  visible,
  currentVersion,
  releaseInfo,
  onClose,
  onSkip,
}) => {
  const { theme: colors } = useTheme();
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadedFileUri, setDownloadedFileUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    if (!releaseInfo.apkDownloadUrl) {
      setErrorMessage('No APK download available');
      setDownloadState('error');
      return;
    }

    try {
      setDownloadState('downloading');
      setErrorMessage(null);

      const fileUri = await downloadApk(
        releaseInfo.apkDownloadUrl,
        (progress, downloaded, total) => {
          const safeProgress = Number.isFinite(progress)
            ? Math.min(1, Math.max(0, progress))
            : 0;
          setDownloadProgress(safeProgress);
          setDownloadedBytes(downloaded);
          setTotalBytes(total);
        },
        releaseInfo.apkSize
      );

      if (fileUri) {
        setDownloadedFileUri(fileUri);
        setDownloadState('downloaded');
      } else {
        // Check if paused by user or partial file exists
        const snapshot = await getApkDownloadState(releaseInfo.apkDownloadUrl, releaseInfo.apkSize);
        if (snapshot.state === 'paused' || snapshot.downloadedBytes > 0) {
          setDownloadProgress(snapshot.progress);
          setDownloadedBytes(snapshot.downloadedBytes);
          setTotalBytes(snapshot.totalBytes);
          setDownloadState('paused');
        } else {
          throw new Error('Download interrupted');
        }
      }
    } catch (error) {
      console.error('Download error:', error);
      // Even on error, refresh partial byte count so the user sees their saved progress is preserved
      const snapshot = await getApkDownloadState(releaseInfo.apkDownloadUrl, releaseInfo.apkSize);
      if (snapshot.downloadedBytes > 0) {
        setDownloadProgress(snapshot.progress);
        setDownloadedBytes(snapshot.downloadedBytes);
        setTotalBytes(snapshot.totalBytes);
      }
      setErrorMessage(error instanceof Error ? error.message : 'Download paused due to network change');
      setDownloadState('error');
    }
  }, [releaseInfo.apkDownloadUrl, releaseInfo.apkSize]);

  // Sync modal state with any in-flight, paused, or completed APK download whenever modal becomes visible
  useEffect(() => {
    if (!visible || !releaseInfo.apkDownloadUrl) return;
    let cancelled = false;

    getApkDownloadState(releaseInfo.apkDownloadUrl, releaseInfo.apkSize).then((snapshot) => {
      if (cancelled) return;
      setDownloadProgress(snapshot.progress);
      setDownloadedBytes(snapshot.downloadedBytes);
      setTotalBytes(snapshot.totalBytes);

      if (snapshot.state === 'downloaded' && snapshot.fileUri) {
        setDownloadedFileUri(snapshot.fileUri);
        setDownloadState('downloaded');
      } else if (snapshot.state === 'downloading') {
        handleDownload();
      } else if (snapshot.state === 'paused') {
        setDownloadState('paused');
      } else {
        setDownloadState('idle');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visible, releaseInfo.apkDownloadUrl, releaseInfo.apkSize, handleDownload]);

  const handlePause = useCallback(async () => {
    await pauseApkDownload();
    setDownloadState('paused');
  }, []);

  const handleSkip = useCallback(async () => {
    await skipVersion(releaseInfo.version);
    onSkip();
  }, [releaseInfo.version, onSkip]);

  const handleOpenInBrowser = useCallback(() => {
    if (releaseInfo.htmlUrl) {
      Linking.openURL(releaseInfo.htmlUrl);
    }
  }, [releaseInfo.htmlUrl]);

  const handleInstall = useCallback(async () => {
    if (!downloadedFileUri) return;

    try {
      setDownloadState('installing');
      await installApk(downloadedFileUri);
      // Note: The app might be closed by the system during installation
    } catch (error) {
      console.error('Installation error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Installation failed');
      setDownloadState('error');
    }
  }, [downloadedFileUri]);

  const handleClose = useCallback(() => {
    // Do NOT delete or wipe download progress when closing the modal!
    // Ongoing downloads continue in the background and paused/completed files stay on disk.
    setErrorMessage(null);
    onClose();
  }, [onClose]);

  const renderReleaseNotes = () => {
    // Simple markdown-like rendering for release notes
    const lines = releaseInfo.releaseNotes.split('\n');
    return lines.map((line, index) => {
      const trimmedLine = line.trim();

      // Heading
      if (trimmedLine.startsWith('## ')) {
        return (
          <Text key={index} style={[styles.releaseNotesHeading, { color: colors.text }]}>
            {trimmedLine.replace('## ', '')}
          </Text>
        );
      }

      // List item
      if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        return (
          <Text key={index} style={[styles.releaseNotesItem, { color: colors.textSecondary }]}>
            • {trimmedLine.replace(/^[-*]\s/, '')}
          </Text>
        );
      }

      // Regular text
      if (trimmedLine) {
        return (
          <Text key={index} style={[styles.releaseNotesText, { color: colors.textSecondary }]}>
            {trimmedLine}
          </Text>
        );
      }

      // Empty line
      return <View key={index} style={styles.releaseNotesSpacer} />;
    });
  };

  const renderDownloadSection = () => {
    // iOS doesn't support auto-install
    if (Platform.OS === 'ios') {
      return (
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={handleOpenInBrowser}
        >
          <Ionicons name="open-outline" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>View on GitHub</Text>
        </TouchableOpacity>
      );
    }

    // Android with APK download
    if (!releaseInfo.apkDownloadUrl) {
      return (
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={handleOpenInBrowser}
        >
          <Ionicons name="open-outline" size={20} color="#FFFFFF" />
          <Text style={styles.primaryButtonText}>View on GitHub</Text>
        </TouchableOpacity>
      );
    }

    const safePercent = Math.round(Math.min(1, Math.max(0, Number.isFinite(downloadProgress) ? downloadProgress : 0)) * 100);

    switch (downloadState) {
      case 'idle':
        return (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleDownload}
          >
            <Ionicons name="download-outline" size={20} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>
              Download APK {releaseInfo.apkSize ? `(${formatBytes(releaseInfo.apkSize)})` : ''}
            </Text>
          </TouchableOpacity>
        );

      case 'downloading':
        return (
          <View style={styles.downloadingContainer}>
            <View style={[styles.progressBarContainer, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressBar,
                  { backgroundColor: colors.primary, width: `${safePercent}%` },
                ]}
              />
            </View>
            <View style={styles.progressRow}>
              <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                Downloading... {safePercent}%
                {totalBytes > 0 && ` (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`}
              </Text>
              <TouchableOpacity onPress={handlePause} style={styles.pauseButton}>
                <Ionicons name="pause-circle-outline" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        );

      case 'paused':
        return (
          <View>
            {downloadedBytes > 0 && (
              <View style={styles.pausedProgressContainer}>
                <View style={[styles.progressBarContainer, { backgroundColor: colors.border }]}>
                  <View
                    style={[
                      styles.progressBar,
                      { backgroundColor: colors.primary, width: `${safePercent}%` },
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, { color: colors.textSecondary, marginBottom: 10 }]}>
                  Paused at {safePercent}%
                  {totalBytes > 0 && ` (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleDownload}
            >
              <Ionicons name="play-outline" size={20} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>
                Resume Download ({safePercent}%)
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 'downloaded':
        return (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.success }]}
            onPress={handleInstall}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Install Update</Text>
          </TouchableOpacity>
        );

      case 'installing':
        return (
          <View style={[styles.primaryButton, { backgroundColor: colors.textSecondary }]}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.primaryButtonText}>Installing...</Text>
          </View>
        );

      case 'error':
        return (
          <View>
            <Text style={[styles.errorText, { color: colors.error }]}>
              {errorMessage || 'An error occurred'}
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={handleDownload}
            >
              <Ionicons name="refresh-outline" size={20} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>
                {downloadedBytes > 0 ? `Resume Download (${safePercent}%)` : 'Retry Download'}
              </Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: colors.primary }]}>
              <Ionicons name="sparkles" size={32} color="#FFFFFF" />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Update Available!</Text>
            <Text style={[styles.versionInfo, { color: colors.textSecondary }]}>
              {currentVersion} → {releaseInfo.version}{releaseInfo.apkArchitecture ? ' (' + releaseInfo.apkArchitecture + ')' : ''}
            </Text>
          </View>

          {/* Release Notes */}
          <View style={[styles.releaseNotesContainer, { borderColor: colors.border }]}>
            <Text style={[styles.releaseNotesTitle, { color: colors.text }]}>
              What's New
            </Text>
            <ScrollView style={styles.releaseNotesScroll} showsVerticalScrollIndicator={false}>
              {renderReleaseNotes()}
            </ScrollView>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {renderDownloadSection()}

            <View style={styles.secondaryButtons}>
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                onPress={handleSkip}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                  Skip This Version
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                onPress={handleClose}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
                  Later
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Platform Note for iOS */}
          {Platform.OS === 'ios' && (
            <Text style={[styles.platformNote, { color: colors.textSecondary }]}>
              Automatic installation is not available on iOS. Please download the IPA from GitHub and sideload with AltStore or Sideloadly.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    maxHeight: '80%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  versionInfo: {
    fontSize: 16,
  },
  releaseNotesContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    maxHeight: 200,
  },
  releaseNotesTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  releaseNotesScroll: {
    maxHeight: 140,
  },
  releaseNotesHeading: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  releaseNotesItem: {
    fontSize: 14,
    lineHeight: 22,
    paddingLeft: 8,
  },
  releaseNotesText: {
    fontSize: 14,
    lineHeight: 22,
  },
  releaseNotesSpacer: {
    height: 8,
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  downloadingContainer: {
    padding: 16,
  },
  pausedProgressContainer: {
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pauseButton: {
    padding: 2,
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  platformNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
});

export default UpdateModal;
