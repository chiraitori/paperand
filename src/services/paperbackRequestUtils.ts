export const appendPaperbackRequestParams = (url: string, param: any): string => {
  if (!param) return url;

  if (typeof param === 'string') {
    const query = param.replace(/^\?/, '');
    return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
  }

  const pairs: string[] = [];
  const entries = param instanceof URLSearchParams
    ? Array.from(param.entries())
    : Object.entries(param);

  for (const [key, rawValue] of entries) {
    if (rawValue === undefined || rawValue === null) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  return pairs.length
    ? `${url}${url.includes('?') ? '&' : '?'}${pairs.join('&')}`
    : url;
};
