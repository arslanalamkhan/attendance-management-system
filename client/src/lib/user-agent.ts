export interface ParsedUserAgent {
  browser: string;
  os: string;
  kind: 'desktop' | 'mobile' | 'unknown';
}

/** Small, dependency-free user-agent summary for the sessions list. */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) return { browser: 'Unknown browser', os: 'Unknown device', kind: 'unknown' };

  let browser = 'Browser';
  const b =
    /Edg(?:e|A|iOS)?\/([\d.]+)/.exec(ua) ??
    /OPR\/([\d.]+)/.exec(ua) ??
    /Firefox\/([\d.]+)/.exec(ua) ??
    /(?:Chrome|CriOS)\/([\d.]+)/.exec(ua) ??
    /Version\/([\d.]+).*Safari/.exec(ua);
  const major = b?.[1]?.split('.')[0];
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/curl|node|python|axios|fetch/i.test(ua)) browser = 'API client';
  if (major && browser !== 'Browser' && browser !== 'API client') browser = `${browser} ${major}`;

  let os = 'Unknown OS';
  if (/Windows NT 10/.test(ua)) os = 'Windows';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  const kind = /Android|iPhone|iPad|iPod|Mobile/.test(ua) ? 'mobile' : os === 'Unknown OS' ? 'unknown' : 'desktop';
  return { browser, os, kind };
}
