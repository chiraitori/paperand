// Deep Link Handler for paperback:// protocol
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ADDED_REPOSITORIES_KEY = '@added_repositories';

export interface DeepLinkAction {
  type: 'addRepo' | 'unknown';
  params: Record<string, string>;
}

// Parse a paperback:// URL
export const parseDeepLink = (url: string): DeepLinkAction | null => {
  try {
    // Handle paperback://addRepo?displayName=...&url=...
    if (url.startsWith('paperback://addRepo')) {
      const queryString = url.split('?')[1];
      if (!queryString) return null;
      
      const params: Record<string, string> = {};
      const pairs = queryString.split('&');
      
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key && value) {
          params[decodeURIComponent(key)] = decodeURIComponent(value);
        }
      }
      
      return {
        type: 'addRepo',
        params,
      };
    }
    
    return { type: 'unknown', params: {} };
  } catch (error) {
    console.error('Error parsing deep link:', error);
    return null;
  }
};

// Add a repository from deep link
export const addRepositoryFromDeepLink = async (
  displayName: string,
  url: string
): Promise<{ success: boolean; message: string }> => {
  try {
    // Load existing repositories
    const stored = await AsyncStorage.getItem(ADDED_REPOSITORIES_KEY);
    const repos: Array<{ id: string; name: string; baseUrl: string }> = stored 
      ? JSON.parse(stored) 
      : [];
    
    // Check if already added
    const existing = repos.find(r => r.baseUrl === url);
    if (existing) {
      return { 
        success: false, 
        message: `Repository "${displayName}" is already added` 
      };
    }
    
    // Generate ID from URL
    const id = url
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    
    // Add new repository
    repos.push({
      id,
      name: displayName,
      baseUrl: url,
    });
    
    await AsyncStorage.setItem(ADDED_REPOSITORIES_KEY, JSON.stringify(repos));
    
    return { 
      success: true, 
      message: `Repository "${displayName}" added successfully!` 
    };
  } catch (error) {
    console.error('Error adding repository from deep link:', error);
    return { 
      success: false, 
      message: 'Failed to add repository' 
    };
  }
};

// Get the initial URL that launched the app
export const getInitialDeepLink = async (): Promise<string | null> => {
  try {
    const url = await Linking.getInitialURL();
    return url;
  } catch (error) {
    console.error('Error getting initial URL:', error);
    return null;
  }
};

// Subscribe to deep link events
export const subscribeToDeepLinks = (
  callback: (url: string) => void
): (() => void) => {
  const subscription = Linking.addEventListener('url', (event: { url: string }) => {
    callback(event.url);
  });
  
  return () => subscription.remove();
};
