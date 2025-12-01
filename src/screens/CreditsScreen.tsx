import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Image,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

interface Contributor {
  name: string;
  role: string;
  github?: string;
  twitter?: string;
}

const CORE_TEAM: Contributor[] = [
  { name: 'Faizan Durrani', role: 'Lead Developer', github: 'FaizanDurrani' },
  { name: 'Lemon', role: 'Core Developer', github: 'lemontea' },
  { name: 'Netsky', role: 'Extensions Developer', github: 'Netsky' },
  { name: 'GameFuzzy', role: 'Extensions Developer', github: 'GameFuzzy' },
];

const CONTRIBUTORS: Contributor[] = [
  { name: 'AlanNois', role: 'Extensions', github: 'AlanNois' },
  { name: 'NmN', role: 'Extensions', github: 'nmn' },
  { name: 'loik9081', role: 'Extensions', github: 'loik9081' },
  { name: 'Moomooo95', role: 'Extensions', github: 'Moomooo95' },
  { name: 'xOnlyFadi', role: 'Extensions', github: 'xOnlyFadi' },
];

const SPECIAL_THANKS = [
  'All our Patreon supporters',
  'The Tachiyomi team for inspiration',
  'Our amazing Discord community',
  'All translators and contributors',
];

export const CreditsScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation();

  const openGithub = (username: string) => {
    Linking.openURL(`https://github.com/${username}`);
  };

  const renderContributor = (contributor: Contributor, index: number) => (
    <TouchableOpacity
      key={index}
      style={[styles.contributorItem, { borderBottomColor: theme.border }]}
      onPress={() => contributor.github && openGithub(contributor.github)}
      activeOpacity={contributor.github ? 0.7 : 1}
    >
      <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
        <Text style={styles.avatarText}>{contributor.name[0]}</Text>
      </View>
      <View style={styles.contributorInfo}>
        <Text style={[styles.contributorName, { color: theme.text }]}>{contributor.name}</Text>
        <Text style={[styles.contributorRole, { color: theme.textSecondary }]}>{contributor.role}</Text>
      </View>
      {contributor.github && (
        <Ionicons name="logo-github" size={24} color={theme.textSecondary} />
      )}
    </TouchableOpacity>
  );

  const renderSection = (title: string, children: React.ReactNode) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionContent, { backgroundColor: theme.card }]}>
        {children}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={28} color={theme.primary} />
          <Text style={[styles.backText, { color: theme.primary }]}>Settings</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>Credits</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* App Logo & Name */}
        <View style={styles.appInfo}>
          <View style={[styles.appIcon, { backgroundColor: theme.primary }]}>
            <Ionicons name="book" size={48} color="#FFF" />
          </View>
          <Text style={[styles.appName, { color: theme.text }]}>Paperback</Text>
          <Text style={[styles.appTagline, { color: theme.textSecondary }]}>
            Ad-Free Manga Reader
          </Text>
        </View>

        {/* Core Team */}
        {renderSection(
          'CORE TEAM',
          CORE_TEAM.map(renderContributor)
        )}

        {/* Contributors */}
        {renderSection(
          'CONTRIBUTORS',
          CONTRIBUTORS.map(renderContributor)
        )}

        {/* Special Thanks */}
        {renderSection(
          'SPECIAL THANKS',
          SPECIAL_THANKS.map((thanks, index) => (
            <View
              key={index}
              style={[styles.thanksItem, { borderBottomColor: theme.border }]}
            >
              <Ionicons name="heart" size={18} color={theme.primary} style={styles.heartIcon} />
              <Text style={[styles.thanksText, { color: theme.text }]}>{thanks}</Text>
            </View>
          ))
        )}

        {/* Links */}
        {renderSection(
          'LINKS',
          <>
            <TouchableOpacity
              style={[styles.linkItem, { borderBottomColor: theme.border }]}
              onPress={() => Linking.openURL('https://github.com/Paperback-iOS/app')}
            >
              <Ionicons name="logo-github" size={24} color={theme.text} />
              <Text style={[styles.linkText, { color: theme.text }]}>GitHub Repository</Text>
              <Ionicons name="open-outline" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkItem, { borderBottomColor: theme.border }]}
              onPress={() => Linking.openURL('https://discord.gg/paperback')}
            >
              <Ionicons name="logo-discord" size={24} color={theme.text} />
              <Text style={[styles.linkText, { color: theme.text }]}>Discord Server</Text>
              <Ionicons name="open-outline" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkItem, { borderBottomColor: theme.border }]}
              onPress={() => Linking.openURL('https://paperback.moe')}
            >
              <Ionicons name="globe-outline" size={24} color={theme.text} />
              <Text style={[styles.linkText, { color: theme.text }]}>Website</Text>
              <Ionicons name="open-outline" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkItem, { borderBottomColor: theme.border }]}
              onPress={() => Linking.openURL('https://www.patreon.com/FaizanDurrani')}
            >
              <Ionicons name="heart-outline" size={24} color={theme.text} />
              <Text style={[styles.linkText, { color: theme.text }]}>Support on Patreon</Text>
              <Ionicons name="open-outline" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </>
        )}

        <Text style={[styles.copyright, { color: theme.textSecondary }]}>
          Made with ❤️ by the Paperback Team
        </Text>
      </ScrollView>
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
  headerSpacer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  appIcon: {
    width: 100,
    height: 100,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  appTagline: {
    fontSize: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionContent: {
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  contributorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  contributorInfo: {
    flex: 1,
  },
  contributorName: {
    fontSize: 17,
    fontWeight: '500',
  },
  contributorRole: {
    fontSize: 14,
    marginTop: 2,
  },
  thanksItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heartIcon: {
    marginRight: 12,
  },
  thanksText: {
    fontSize: 17,
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkText: {
    fontSize: 17,
    flex: 1,
    marginLeft: 12,
  },
  copyright: {
    textAlign: 'center',
    fontSize: 14,
    marginTop: 16,
  },
});
