import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Card, Stack, TextField, Typography } from '@mui/material';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, ago } from '../api.js';
import { useLive, useLiveEvent, useNow } from '../live.jsx';
import { Overline, StatusBadge } from '../components/status.jsx';

/** Contact tab. me = "astronaut" (talking to the doctor) or "doctor" (talking to astronaut `id`). */
export default function Contact({ id, me }) {
  const { doctor, nameOf, records, storage } = useLive();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow(10000);
  const end = useRef(null);
  const other = me === 'astronaut' ? doctor.name : nameOf(id);

  useEffect(() => {
    let live = true;
    setMessages([]);
    api.get('/messages', { astronaut_id: id }).then((d) => { if (live) setMessages(d.messages); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id]);
  useLiveEvent('message', (m) => {
    if (m.astronaut_id === id) setMessages((list) => (list.some((x) => x.message_id === m.message_id) ? list : [...list, m]));
  });
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const m = await api.post('/messages', { astronaut_id: id, sender: me, text: body });
      setMessages((list) => (list.some((x) => x.message_id === m.message_id) ? list : [...list, m]));
      setText(''); setError('');
    } catch (err) {
      setError(`Message not sent. ${err.message}. Your text is still in the box.`);
    } finally { setBusy(false); }
  };

  const rec = records[id];
  return (
    <Stack spacing={2}>
      <Box>
        <Overline>{me === 'astronaut' ? 'Your crew medical officer' : 'Crew member'}</Overline>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h1">{other}</Typography>
          {me === 'doctor' && rec && <StatusBadge level={rec.overall.level} />}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {me === 'astronaut' ? `${doctor.role}. For urgent help use Send Alert at the top of the screen.` : 'Messages are stored with the mission record.'}
          {storage?.offline ? ' Saved on this device (offline mode).' : ''}
        </Typography>
      </Box>
      <Card sx={{ display: 'flex', flexDirection: 'column', height: { xs: '52vh', md: '56vh' } }}>
        <Box sx={{ flex: 1, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }} aria-live="polite">
          {messages.length === 0 && <Typography color="text.secondary" sx={{ m: 'auto' }}>No messages yet. Say hello.</Typography>}
          {messages.map((m) => {
            const mine = m.sender === me;
            return (
              <Box key={m.message_id} sx={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                <Box sx={{ px: 2, py: 1.25, borderRadius: 2, bgcolor: mine ? 'primary.main' : 'action.hover', color: mine ? 'primary.contrastText' : 'text.primary',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.text}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: mine ? 'right' : 'left', mt: 0.25 }}>
                  {mine ? 'You' : (m.sender === 'doctor' ? doctor.name : nameOf(m.astronaut_id))} · MET {m.met} · {ago(m.sent_at, now)}
                </Typography>
              </Box>
            );
          })}
          <div ref={end} />
        </Box>
        <Box component="form" onSubmit={send} sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <TextField fullWidth size="small" placeholder={`Message ${other}…`} value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))}
            slotProps={{ htmlInput: { 'aria-label': `Message ${other}` } }} />
          <Button type="submit" variant="contained" disabled={busy || !text.trim()} endIcon={<SendRounded />}>Send</Button>
        </Box>
      </Card>
      {error && <Typography color="error" variant="body2" role="alert">{error}</Typography>}
    </Stack>
  );
}
