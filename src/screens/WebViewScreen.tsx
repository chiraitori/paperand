import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform, ActivityIndicator, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { getCookies as getNativeCookies } from 'cloudflare-bypass';
import { useTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../types';
import { setCookiesForDomain } from '../services/cookieStore';

type WebViewRouteProp = RouteProp<RootStackParamList, 'WebView'>;
type WebViewNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const WebViewScreen: React.FC = () => {
  const { theme } = useTheme();
  const navigation = useNavigation<WebViewNavigationProp>();
  const route = useRoute<WebViewRouteProp>();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  const { url, title, headers, method } = route.params;
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [cookiesSynced, setCookiesSynced] = useState(false);

  const handleOpenExternal = () => {
    Linking.openURL(currentUrl).catch(err => console.error('Failed to open URL in external browser:', err));
  };

  // Read cookies from Android's native CookieManager (shared with WebView)
  // and store them in our in-memory cookie store for the ExtensionRunner fetch proxy
  const syncCookiesFromNative = useCallback(async (targetUrl: string) => {
    try {
      const cookies = await getNativeCookies(targetUrl);
      if (cookies && cookies.length > 0) {
        console.log('[WebViewScreen] Native cookies:', cookies.substring(0, 120));
        setCookiesForDomain(targetUrl, cookies);

        // Check if cf_clearance is present
        if (cookies.includes('cf_clearance')) {
          console.log('[WebViewScreen] ✅ cf_clearance cookie found! Cloudflare bypassed.');
          if (!cookiesSynced) {
            setCookiesSynced(true);
            Alert.alert(
              'Cloudflare Bypassed! ✅',
              'Cookies đã được đồng bộ. Quay lại để tiếp tục đọc truyện.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            );
          }
        }
      }
    } catch (e) {
      console.warn('[WebViewScreen] Failed to read native cookies:', e);
    }
  }, [cookiesSynced, navigation]);

  // Poll cookies periodically while the page is loaded
  useEffect(() => {
    if (cookiesSynced) return;

    const interval = setInterval(() => {
      syncCookiesFromNative(currentUrl);
    }, 3000); // Check every 3 seconds

    return () => clearInterval(interval);
  }, [currentUrl, cookiesSynced, syncCookiesFromNative]);

  // After each navigation finishes, sync cookies from native
  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setCurrentUrl(navState.url);

    if (!navState.loading) {
      // Page finished loading — read cookies from native CookieManager
      syncCookiesFromNative(navState.url);
    }
  }, [syncCookiesFromNative]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[
        styles.header,
        {
          backgroundColor: theme.card,
          borderBottomColor: theme.border,
          paddingTop: Math.max(insets.top + 10, Platform.OS === 'ios' ? 50 : 20)
        }
      ]}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="close" size={24} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.titleContainer}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {title || 'Browser'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {currentUrl}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => webViewRef.current?.reload()}
          >
            <Ionicons name="refresh" size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleOpenExternal}
          >
            <Ionicons name={Platform.OS === 'ios' ? 'compass-outline' : 'open-outline'} size={22} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/*
        CLEAN WebView — NO injected JavaScript, NO onMessage.
        This means react-native-webview will NOT inject window.ReactNativeWebView,
        making this WebView invisible to Cloudflare Turnstile detection.
        Cookies are read natively via Android CookieManager instead.
      */}
      <WebView
        ref={webViewRef}
        source={{ uri: url, headers, method }}
        style={styles.webview}
        originWhitelist={['*']}
        onNavigationStateChange={handleNavigationStateChange}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        )}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        domStorageEnabled={true}
        javaScriptEnabled={true}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        mixedContentMode="compatibility"
        cacheEnabled={true}
      />

      {/* Bottom Navigation Toolbar */}
      <View style={[
        styles.toolbar,
        {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          paddingBottom: Math.max(insets.bottom, 8),
        }
      ]}>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color={canGoBack ? theme.text : theme.textSecondary}
            style={{ opacity: canGoBack ? 1 : 0.4 }}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => webViewRef.current?.goForward()}
          disabled={!canGoForward}
        >
          <Ionicons
            name="chevron-forward"
            size={28}
            color={canGoForward ? theme.text : theme.textSecondary}
            style={{ opacity: canGoForward ? 1 : 0.4 }}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }} />
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
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  headerButton: {
    padding: 8,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  toolbarButton: {
    padding: 8,
    marginRight: 16,
  },
});
