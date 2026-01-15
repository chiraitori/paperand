---
name: Cache Management
description: Image caching and storage management with expo-image
---

# Cache Management

## Cache Service

```typescript
import { cacheService } from '../services/cacheService';

// Get cache size
const size = await cacheService.getCacheSize(); // bytes

// Clear cache
await cacheService.clearCache();

// Set cache limit
await cacheService.setCacheLimit(500); // MB

// Get cache limit
const limit = await cacheService.getCacheLimit();
```

## expo-image Caching

```typescript
import { Image } from 'expo-image';

// Cached image
<Image
  source={{ uri: imageUrl }}
  cachePolicy="memory-disk"  // Cache in memory and disk
  placeholder={blurhash}
  recyclingKey={manga.id}    // Optimize recycling
/>

// Cache policies
// 'none' - No caching
// 'disk' - Disk only
// 'memory' - Memory only  
// 'memory-disk' - Both (recommended)

// Prefetch images
await Image.prefetch(imageUrl);
await Image.prefetch([url1, url2, url3]);

// Clear image cache
await Image.clearDiskCache();
await Image.clearMemoryCache();
```

## File System Cache

```typescript
import * as FileSystem from 'expo-file-system';

const cacheDir = FileSystem.cacheDirectory;

// Get directory size
async function getDirectorySize(dir: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return 0;
  
  // Read all files recursively
  let size = 0;
  const items = await FileSystem.readDirectoryAsync(dir);
  for (const item of items) {
    const itemPath = `${dir}${item}`;
    const itemInfo = await FileSystem.getInfoAsync(itemPath);
    if (itemInfo.isDirectory) {
      size += await getDirectorySize(`${itemPath}/`);
    } else {
      size += itemInfo.size || 0;
    }
  }
  return size;
}

// Clear directory
async function clearDirectory(dir: string) {
  await FileSystem.deleteAsync(dir, { idempotent: true });
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}
```

## Storage Keys

| Key | Purpose | Location |
|-----|---------|----------|
| Image cache | Manga covers, pages | `cacheDirectory` |
| Downloads | Offline chapters | `documentDirectory/downloads/` |
| Extensions | Extension bundles | `documentDirectory/extensions/` |
| Settings | User preferences | AsyncStorage |

## Cache Settings UI

```typescript
function CacheSettings() {
  const [cacheSize, setCacheSize] = useState(0);
  const [limit, setLimit] = useState(500);

  useEffect(() => {
    loadCacheInfo();
  }, []);

  const loadCacheInfo = async () => {
    const size = await cacheService.getCacheSize();
    const limit = await cacheService.getCacheLimit();
    setCacheSize(size);
    setLimit(limit);
  };

  const handleClear = async () => {
    await cacheService.clearCache();
    setCacheSize(0);
  };

  return (
    <View>
      <Text>Cache: {formatBytes(cacheSize)} / {limit} MB</Text>
      <Button title="Clear Cache" onPress={handleClear} />
    </View>
  );
}
```

## Format Bytes Helper

```typescript
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
```
