import { useEffect, useState } from 'react';

let publicUrl: Promise<string> | null = null;
/** The URL phones should open: PUBLIC_URL from the server, else this page's origin. */
export function usePlayUrl(): string {
  const [url, setUrl] = useState(`${location.origin}/play`);
  useEffect(() => {
    publicUrl ??= fetch('/api/config')
      .then(r => r.json() as Promise<{ publicUrl: string | null }>)
      .then(c => (c.publicUrl ?? location.origin).replace(/\/+$/, ''))
      .catch(() => location.origin);
    void publicUrl.then(base => setUrl(`${base}/play`));
  }, []);
  return url;
}
