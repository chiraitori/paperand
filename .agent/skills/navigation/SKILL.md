---
name: React Navigation Patterns
description: Navigation setup and patterns for React Navigation 7
---

# React Navigation Patterns

## Stack Navigator

```typescript
import { createNativeStackNavigator } from '@react-navigation/native-stack';

type RootStackParamList = {
  Home: undefined;
  MangaDetail: { manga: Manga; sourceId: string };
  Reader: { manga: Manga; chapter: Chapter; sourceId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="MangaDetail" component={MangaDetailScreen} />
      <Stack.Screen name="Reader" component={ReaderScreen} />
    </Stack.Navigator>
  );
}
```

## Bottom Tab Navigator

```typescript
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

const Tab = createBottomTabNavigator();

function BottomTabNavigator() {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Library: 'library',
            Discover: 'compass',
            History: 'time',
            More: 'ellipsis-horizontal',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.card },
      })}
    >
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
```

## Navigation Hooks

```typescript
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';

// Navigate
const navigation = useNavigation();
navigation.navigate('MangaDetail', { manga, sourceId });
navigation.goBack();
navigation.setOptions({ title: 'New Title' });

// Get params
const route = useRoute();
const { manga, sourceId } = route.params;

// Focus effect (runs when screen focused)
useFocusEffect(
  useCallback(() => {
    loadData();
    return () => cleanup();
  }, [])
);
```

## Screen Options

```typescript
// Per-screen options
<Stack.Screen
  name="Reader"
  component={ReaderScreen}
  options={{
    headerShown: false,
    orientation: 'all',
    gestureEnabled: false,
  }}
/>

// Dynamic options in component
useLayoutEffect(() => {
  navigation.setOptions({
    headerRight: () => <Button onPress={handleAction} />,
  });
}, []);
```

## Deep Linking

```typescript
// app.json
{
  "expo": {
    "scheme": "paperand",
    "android": {
      "intentFilters": [{
        "action": "VIEW",
        "data": [{ "scheme": "paperback" }],
        "category": ["BROWSABLE", "DEFAULT"]
      }]
    }
  }
}

// Handle deep link
import * as Linking from 'expo-linking';

const url = await Linking.getInitialURL();
Linking.addEventListener('url', handleDeepLink);
```

## Navigation Types

```typescript
// Define in types/navigation.ts
export type RootStackParamList = {
  Main: undefined;
  MangaDetail: { manga: Manga; sourceId: string };
  Reader: { manga: Manga; chapter: Chapter; sourceId: string };
  Search: { query?: string };
  Extensions: undefined;
  Settings: undefined;
};

// Type-safe navigation
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
const navigation = useNavigation<NavigationProp>();
```
