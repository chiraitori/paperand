---
name: Deep Linking
description: URL schemes and deep link handling
---

# Deep Linking

## URL Schemes

| Scheme | Platform | Example |
|--------|----------|---------|
| `paperand://` | Both | `paperand://manga/123` |
| `paperback://` | Both | `paperback://source/add?url=...` |

## App Config

```json
// app.json
{
  "expo": {
    "scheme": "paperand",
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [{ "scheme": "paperback" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

## Handle Deep Links

```typescript
import * as Linking from 'expo-linking';

// Get initial URL (app opened via link)
const initialUrl = await Linking.getInitialURL();
if (initialUrl) {
  handleDeepLink(initialUrl);
}

// Listen for links while app is open
useEffect(() => {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleDeepLink(url);
  });
  return () => subscription.remove();
}, []);
```

## Parse Deep Links

```typescript
function handleDeepLink(url: string) {
  const parsed = Linking.parse(url);
  // { scheme: 'paperand', path: 'manga/123', queryParams: {} }

  const [action, id] = parsed.path?.split('/') || [];

  switch (action) {
    case 'manga':
      navigation.navigate('MangaDetail', { mangaId: id });
      break;
    case 'chapter':
      navigation.navigate('Reader', { chapterId: id });
      break;
    case 'source':
      if (parsed.queryParams?.url) {
        handleAddSource(parsed.queryParams.url);
      }
      break;
  }
}
```

## Deep Link Service

```typescript
// services/deepLinkService.ts
import * as Linking from 'expo-linking';

export const deepLinkService = {
  async handleUrl(url: string) {
    const parsed = Linking.parse(url);
    return parsed;
  },

  createMangaLink(mangaId: string): string {
    return Linking.createURL(`manga/${mangaId}`);
  },

  createSourceLink(repoUrl: string): string {
    return Linking.createURL('source/add', {
      queryParams: { url: repoUrl },
    });
  },
};
```

## Paperback Source Links

Handle Paperback-style source repository links:

```typescript
// paperback://addRepo?name=MyRepo&url=https://...
function handlePaperbackLink(url: string) {
  const parsed = Linking.parse(url);
  
  if (parsed.path === 'addRepo') {
    const { name, url: repoUrl } = parsed.queryParams;
    navigation.navigate('AddRepository', { name, url: repoUrl });
  }
}
```

## Share Links

```typescript
import * as Sharing from 'expo-sharing';

async function shareManga(manga: Manga) {
  const link = deepLinkService.createMangaLink(manga.id);
  await Sharing.shareAsync(link, {
    dialogTitle: `Share ${manga.title}`,
  });
}
```

## Testing Deep Links

```bash
# Android
adb shell am start -a android.intent.action.VIEW -d "paperand://manga/123"

# iOS Simulator
xcrun simctl openurl booted "paperand://manga/123"
```
