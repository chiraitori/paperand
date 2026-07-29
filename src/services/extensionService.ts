// Extension Repository Types
export type PaperbackApiVersion = '0.8' | '0.9';

export interface ExtensionSource {
  id: string;
  name: string;
  author: string;
  desc: string;
  website: string;
  contentRating: 'EVERYONE' | 'MATURE' | 'ADULT';
  version: string;
  icon: string;
  tags: ExtensionTag[];
  websiteBaseURL: string;
  intents: number;
  apiVersion: PaperbackApiVersion;
  bundleFilename: 'source.js' | 'index.js';
  assetDirectory: 'includes' | 'static';
  language?: string;
  developers?: { name: string; github?: string; website?: string }[];
}

export interface ExtensionTag {
  text: string;
  type: 'default' | 'info' | 'success' | 'warning' | 'danger';
}

export interface ExtensionRepository {
  id: string;
  name: string;
  baseUrl: string;
  icon?: string;
}

export interface VersioningResponse {
  buildTime: string;
  sources: ExtensionSource[];
  builtWith: {
    toolchain: string;
    types: string;
  };
  repository?: {
    name?: string;
    description?: string;
  };
}

// Default repositories - known repository URLs
export const DEFAULT_REPOSITORIES: ExtensionRepository[] = [];

// API Functions
const cleanBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export const detectPaperbackApiVersion = (
  builtWith?: Partial<VersioningResponse['builtWith']>
): PaperbackApiVersion => {
  const version = `${builtWith?.types || ''} ${builtWith?.toolchain || ''}`.toLowerCase();

  // Paperback 0.9 repositories were built with the 1.0 alpha toolchain and
  // publish index.js/info.json/static. Older repositories publish source.js.
  if (version.includes('0.8')) return '0.8';
  return /(^|\s)(0\.9|1\.)/.test(version) ? '0.9' : '0.8';
};

const normalizeTagType = (type: unknown): ExtensionTag['type'] => {
  const normalized = String(type || 'default').toLowerCase();
  if (normalized === 'blue' || normalized === 'info') return 'info';
  if (normalized === 'green' || normalized === 'success') return 'success';
  if (normalized === 'yellow' || normalized === 'warning') return 'warning';
  if (normalized === 'red' || normalized === 'danger' || normalized === 'error') return 'danger';
  return 'default';
};

export const normalizeExtensionSource = (
  source: any,
  apiVersion: PaperbackApiVersion
): ExtensionSource => {
  const developers = Array.isArray(source?.developers) ? source.developers : [];
  const primaryDeveloper = developers[0];
  const badges = Array.isArray(source?.badges) ? source.badges : [];
  const tags = Array.isArray(source?.tags) ? source.tags : badges;

  return {
    ...source,
    id: String(source?.id || source?.name || ''),
    name: String(source?.name || source?.id || 'Unknown Extension'),
    author: String(source?.author || primaryDeveloper?.name || 'Unknown'),
    desc: String(source?.desc || source?.description || ''),
    website: String(
      source?.website
      || primaryDeveloper?.website
      || primaryDeveloper?.github
      || ''
    ),
    contentRating: source?.contentRating || 'EVERYONE',
    version: String(source?.version || '0.0.0'),
    icon: String(source?.icon || 'icon.png'),
    tags: tags.map((tag: any) => ({
      text: String(tag?.text || tag?.label || tag?.title || ''),
      type: normalizeTagType(tag?.type || tag?.color),
    })).filter((tag: ExtensionTag) => tag.text.length > 0),
    websiteBaseURL: String(source?.websiteBaseURL || source?.websiteBaseUrl || ''),
    intents: Number(source?.intents ?? source?.capabilities ?? 0),
    apiVersion,
    bundleFilename: apiVersion === '0.9' ? 'index.js' : 'source.js',
    assetDirectory: apiVersion === '0.9' ? 'static' : 'includes',
    language: source?.language,
    developers,
  };
};

export const getExtensionBundleUrl = (
  baseUrl: string,
  extension: Pick<ExtensionSource, 'id' | 'bundleFilename'>
): string => `${cleanBaseUrl(baseUrl)}/${extension.id}/${extension.bundleFilename}`;

export const getExtensionIconUrl = (
  baseUrl: string,
  extension: Pick<ExtensionSource, 'id' | 'icon' | 'assetDirectory'>
): string => `${cleanBaseUrl(baseUrl)}/${extension.id}/${extension.assetDirectory}/${extension.icon}`;

export const fetchRepositoryVersioning = async (baseUrl: string): Promise<VersioningResponse | null> => {
  try {
    const response = await fetch(`${cleanBaseUrl(baseUrl)}/versioning.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const apiVersion = detectPaperbackApiVersion(data?.builtWith);
    const sources = Array.isArray(data?.sources)
      ? data.sources.map((source: any) => normalizeExtensionSource(source, apiVersion))
      : [];

    return {
      ...data,
      sources,
      builtWith: data?.builtWith || { toolchain: '', types: '' },
    };
  } catch (error) {
    console.error(`Failed to fetch from ${baseUrl}:`, error);
    return null;
  }
};

export const fetchAllExtensions = async (repositories: ExtensionRepository[]): Promise<Map<string, ExtensionSource[]>> => {
  const extensionsMap = new Map<string, ExtensionSource[]>();
  
  await Promise.all(
    repositories.map(async (repo) => {
      const versioning = await fetchRepositoryVersioning(repo.baseUrl);
      if (versioning && versioning.sources) {
        extensionsMap.set(repo.id, versioning.sources);
      }
    })
  );
  
  return extensionsMap;
};

// Tag color mapping
export const getTagColor = (type: ExtensionTag['type']): { bg: string; text: string } => {
  switch (type) {
    case 'warning':
      return { bg: '#FFD60A', text: '#000000' };
    case 'danger':
      return { bg: '#FF453A', text: '#FFFFFF' };
    case 'success':
      return { bg: '#32D74B', text: '#FFFFFF' };
    case 'info':
      return { bg: '#007AFF', text: '#FFFFFF' };
    default:
      return { bg: '#636366', text: '#FFFFFF' };
  }
};
