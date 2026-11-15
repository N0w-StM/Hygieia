import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Snackbar, Stack, Typography } from '@mui/material';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import { api } from './api.js';
import { prefs, useLive, useLiveEvent } from './live.jsx';

/**
 * Unread contact-tab messages for this window's role. Only messages from the other side count
 * (the sender is never notified of their own message). `openId` is the astronaut whose thread is
 * on screen right now (contact tab open), or null; opening it marks that thread as read.
 * "Read up to" is the server sent_at of the newest message seen, kept per role and astronaut
 * (both demo windows share localStorage, so the key must include the role).
 */
export function useUnreadMessages(role, astronautId, openId) {
  const { connected } = useLive();
  const [unread, setUnread] = useState({}); // astronaut_id -> count
  const [toast, setToast] = useState(null);
  const newest = useRef({}); // astronaut_id -> newest incoming sent_at
  const key = useCallback((id) => `msgSeen.${role}.${id}`, [role]);

  const markRead = useCallback((id) => {
    const ts = newest.current[id];
    if (ts && ts > prefs.get(key(id), '')) prefs.set(key(id), ts);
    setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u));
    setToast((t) => (t && t.astronaut_id === id ? null : t));
  }, [key]);

  // Initial count, and a resync after every reconnect.
  useEffect(() => {
    if (!connected) return undefined;
    let live = true;
    api.get('/messages', { astronaut_id: role === 'astronaut' ? astronautId : null, limit: 1000 }).then((d) => {
      if (!live) return;
      const counts = {};
      newest.current = {};
      for (const m of d.messages) {
        if (m.sender === role) continue;
        const id = m.astronaut_id;
        if (!newest.current[id] || m.sent_at > newest.current[id]) newest.current[id] = m.sent_at;
        if (m.sent_at > prefs.get(key(id), '')) counts[id] = (counts[id] || 0) + 1;
      }
      setUnread(counts);
      if (openId) markRead(openId);
    }).catch(() => {});
    return () => { live = false; };
    // openId is applied by the effect below; refetching on every tab change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, role, astronautId, key, markRead]);

  useEffect(() => { if (openId) markRead(openId); }, [openId, markRead]);

  useLiveEvent('message', (m) => {
    if (m.sender === role || (role === 'astronaut' && m.astronaut_id !== astronautId)) return;
    const id = m.astronaut_id;
    if (!newest.current[id] || m.sent_at > newest.current[id]) newest.current[id] = m.sent_at;
    if (openId === id) { markRead(id); return; }
    setUnread((u) => ({ ...u, [id]: (u[id] || 0) + 1 }));
    setToast(m);
  });

  const total = role === 'astronaut'
    ? unread[astronautId] || 0
    : Object.values(unread).reduce((n, x) => n + x, 0);
  return { unread, total, toast, clearToast: () => setToast(null) };
}

export function MessageToast({ role, toast, onClose, onOpen }) {
  const { doctor, nameOf } = useLive();
  if (!toast) return null;
  const from = role === 'astronaut' ? doctor.name : nameOf(toast.astronaut_id);
  return (
    <Snackbar open key={toast.message_id} autoHideDuration={8000} onClose={(_, reason) => { if (reason !== 'clickaway') onClose(); }}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }} sx={{ top: { xs: 104, sm: 24 } }}>
      <Box role="status" sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 2, maxWidth: 400, boxShadow: 6 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          <ForumOutlined fontSize="small" />
          <Typography variant="subtitle2">New message from {from}</Typography>
        </Stack>
        <Typography variant="body2" sx={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{toast.text}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onClose}>Dismiss</Button>
          <Button size="small" variant="contained" onClick={() => onOpen(toast.astronaut_id)}>Open</Button>
        </Stack>
      </Box>
    </Snackbar>
  );
}
