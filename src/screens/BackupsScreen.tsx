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

interface Backup {
  id: string;
  name: string;
  date: string;
}

export const BackupsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const [backups, setBackups] = useState<Backup[]>([]);

  const handleNewBackup = () => {
    const newBackup: Backup = {
      id: Date.now().toString(),
      name: `Backup ${new Date().toLocaleDateString()}`,
      date: new Date().toISOString(),
    };
    setBackups([newBackup, ...backups]);
    Alert.alert('Backup Created', 'Your backup has been created successfully.');
  };

  const handleExportBackup = (backup: Backup) => {
    Alert.alert('Export Backup', `Exporting "${backup.name}"...`);
  };

  const handleDeleteBackup = (backup: Backup) => {
    Alert.alert(
      'Delete Backup',
      `Are you sure you want to delete "${backup.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBackups(backups.filter(b => b.id !== backup.id));
          },
        },
      ]
    );
  };

  const renderBackupItem = ({ item }: { item: Backup }) => (
    <TouchableOpacity
      style={[styles.backupItem, { backgroundColor: theme.card, borderBottomColor: theme.border }]}
      onPress={() => handleExportBackup(item)}
      onLongPress={() => handleDeleteBackup(item)}
    >
      <View>
        <Text style={[styles.backupName, { color: theme.text }]}>{item.name}</Text>
        <Text style={[styles.backupDate, { color: theme.textSecondary }]}>
          {new Date(item.date).toLocaleString()}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Settings</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Backups</Text>
        <TouchableOpacity
          style={styles.newBackupButton}
          onPress={handleNewBackup}
        >
          <Text style={[styles.newBackupText, { color: theme.primary }]}>New Backup</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
          Select a backup to export
        </Text>

        {backups.length > 0 ? (
          <FlatList
            data={backups}
            renderItem={renderBackupItem}
            keyExtractor={(item) => item.id}
            style={styles.list}
          />
        ) : null}
      </View>
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
    paddingTop: 50,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backText: {
    fontSize: 17,
    marginLeft: -2,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  newBackupButton: {
    flex: 1,
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  newBackupText: {
    fontSize: 17,
  },
  content: {
    flex: 1,
    paddingTop: 16,
  },
  sectionHeader: {
    fontSize: 15,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  backupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  backupName: {
    fontSize: 17,
    fontWeight: '400',
  },
  backupDate: {
    fontSize: 13,
    marginTop: 4,
  },
});
