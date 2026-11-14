async function request(path, { params, body, method } = {}) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)) : '';
  const res = await fetch(`/api${path}${qs}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
    throw new Error(typeof detail === 'string' ? detail : 'Request failed');
  }
  return res.json();
}

export const api = {
  get: (path, params) => request(path, { params }),
  post: (path, body) => request(path, { body: body || {}, method: 'POST' }),
};

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`hygieia.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`hygieia.${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

// "2031-02-05T18:00:00Z" -> "18:00 UTC"
export const missionClock = (iso) => (iso ? `${iso.slice(11, 16)} UTC` : '');

export function ago(iso, now) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
