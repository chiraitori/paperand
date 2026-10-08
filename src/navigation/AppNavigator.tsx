import React, { useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { useTheme } from '../context/ThemeContext';
import { BottomTabNavigator } from './BottomTabNavigator';
import { MangaDetailScreen, ReaderScreen, GeneralSettingsScreen, LanguageSettingsScreen, ThemeSettingsScreen, BackupsScreen, ExtensionsScreen, ExtensionDetailScreen, ExtensionSettingsScreen, AddRepositoryScreen, BrowseRepositoryScreen, BrowseAllRepositoriesScreen, DeveloperScreen, DownloadManagerScreen, CreditsScreen, CategoryScreen, SearchResultsScreen, GenreListScreen, WebViewScreen } from '../screens';
import { RootStackParamList } from '../types';
import { parseDeepLink } from '../services/deepLinkService';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();

// Handle a paperback:// deep link URL
const handleDeepLinkUrl = (url: string) => {
  console.log('[DeepLink] Handling URL:', url);
  const action = parseDeepLink(url);
  if (!action) return;

  if (action.type === 'addRepo') {
    const { displayName, url: repoUrl } = action.params;
    if (repoUrl) {
      // Wait for navigation to be ready
      const navigate = () => {
        if (navigationRef.isReady()) {
          navigationRef.navigate('AddRepository', {
            name: displayName || '',
            url: repoUrl,
          });
        } else {
          setTimeout(navigate, 100);
        }
      };
      navigate();
    }
  }
};

export const AppNavigator: React.FC = () => {
  const { theme, isDark } = useTheme();

  // Handle deep links
  useEffect(() => {
    // Handle URL that opened the app
    const handleInitialUrl = async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        handleDeepLinkUrl(url);
      }
    };
    handleInitialUrl();

    // Listen for URLs while the app is open
    const subscription = Linking.addEventListener('url', (event: { url: string }) => {
      handleDeepLinkUrl(event.url);
    });

    return () => subscription.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Main" component={BottomTabNavigator} />
        <Stack.Screen name="MangaDetail" component={MangaDetailScreen} />
        <Stack.Screen name="Reader" component={ReaderScreen} />
        <Stack.Screen name="GeneralSettings" component={GeneralSettingsScreen} />
        <Stack.Screen name="LanguageSettings" component={LanguageSettingsScreen} />
        <Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen} />
        <Stack.Screen name="Backups" component={BackupsScreen} />
        <Stack.Screen name="Extensions" component={ExtensionsScreen} />
        <Stack.Screen name="ExtensionDetail" component={ExtensionDetailScreen} />
        <Stack.Screen name="ExtensionSettings" component={ExtensionSettingsScreen} />
        <Stack.Screen
          name="AddRepository"
          component={AddRepositoryScreen}
          options={{
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
          }}
        />
        <Stack.Screen name="BrowseAllRepositories" component={BrowseAllRepositoriesScreen} />
        <Stack.Screen name="BrowseRepository" component={BrowseRepositoryScreen} />
        <Stack.Screen name="Developer" component={DeveloperScreen} />
        <Stack.Screen name="DownloadManager" component={DownloadManagerScreen} />
        <Stack.Screen name="Credits" component={CreditsScreen} />
        <Stack.Screen name="Category" component={CategoryScreen} />
        <Stack.Screen name="SearchResults" component={SearchResultsScreen} />
        <Stack.Screen name="GenreList" component={GenreListScreen} />
        <Stack.Screen name="WebView" component={WebViewScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
