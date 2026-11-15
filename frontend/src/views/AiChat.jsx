import React, { useState } from 'react';
import { Box, Button, Card, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api.js';
import { useLive } from '../live.jsx';
import { Overline, StatusBadge, UI } from '../components/status.jsx';

// Live answers come from Google Gemini through the backend (POST /api/chat). If the backend says the
// live model is unavailable, or the request fails, the OFFLINE DEMO ANSWERS below answer instead:
// fixed templates filled from the astronaut's current status. Each reply shows which mode answered.
const LIVE = 'Live AI (Gemini)';
const OFFLINE = 'Offline demo answers';
const URGENT = /chest pain|chest hurts|can'?t breathe|cannot breathe|trouble breathing|short of breath|faint|passed out|severe headache|confus|vision|stroke|bleeding|injur|kill myself|suicid|self[- ]harm|hurt myself|end my life|want to die/;
const QUESTIONS = ['How am I doing today?', 'Why is my status flagged?', 'How did I sleep?', 'What should I do now?'];

function answer(q, rec) {
  const s = rec.astronaut_summary;
  const flagged = rec.systems.filter((x) => x.level > 0).map((x) => `${x.name} (${UI[x.level]})`);
  const t = q.toLowerCase();
  if (URGENT.test(t)) {
    return 'Please contact your flight surgeon now. Stop what you are doing, sit or lie down, and follow your emergency protocol. Use the Send Alert button at the top of the screen or the Contact doctor tab.';
  }
  // Order matters: "how am I doing" contains "do", so status questions are matched first.
  if (t.includes('sleep')) return `Your last sleep period was ${rec.systems.find((x) => x.key === 'brain').metric.value}.`;
  if (t.includes('how am i') || t.includes('okay') || t.includes('doing') || t.includes('status today')) {
    return `${s.title}. ${s.body}`;
  }
  if (t.includes('why') || t.includes('flag') || t.includes('watch') || t.includes('critical')) {
    return flagged.length
      ? `These were flagged for review on your latest reading: ${flagged.join(', ')}. ${s.next_action ? s.next_action.text : ''}`
      : 'Nothing is flagged on your latest reading.';
  }
  if (t.includes('what should') || t.includes('do now') || t.includes('action') || t.includes('next')) {
    return s.next_action ? s.next_action.text : 'No action needed. Continue your planned routine.';
  }
  return 'I only have a few fixed answers in this demo. Try one of the suggested questions, or message your medical officer.';
}

export default function AiChat({ id, go }) {
  const { records } = useLive();
  const rec = records[id];
  const [log, setLog] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!rec) return <Typography color="text.secondary">Waiting for your first reading…</Typography>;
  const critical = rec.astronaut_summary.level === 2;
  const lastMode = log.length ? log[log.length - 1].mode : null;
  const ask = async (q) => {
    const v = q.trim();
    if (!v || busy) return;
    setBusy(true); setText('');
    const history = log.flatMap((m) => [{ role: 'user', text: m.q }, { role: 'model', text: m.a }]).slice(-6);
    let reply = null;
    try {
      const r = await api.post('/chat', { astronaut_id: id, message: v, history });
      if (r.mode === 'live' && r.answer) reply = { a: r.answer, mode: LIVE };
    } catch { /* backend unreachable: offline answers below */ }
    setLog((l) => [...l, { q: v, ...(reply || { a: answer(v, rec), mode: OFFLINE }) }]);
    setBusy(false);
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Overline>Hygieia health assistant</Overline>
        <Typography variant="h1">Your status. In plain language.</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Chip label={lastMode || LIVE} color={lastMode === OFFLINE ? 'warning' : 'primary'} variant="outlined" />
          <Typography variant="body2" color="text.secondary">
            {lastMode === OFFLINE
              ? 'The live AI could not answer, so fixed replies built from your latest reading are shown.'
              : 'Answers use only your own latest reading. If the live AI is unreachable, fixed offline replies are used instead.'}
          </Typography>
        </Stack>
      </Box>

      {critical && (
        <Card sx={(t) => ({ borderColor: t.hy.critical })}>
          <Box sx={{ p: 2.5 }} role="alert">
            <StatusBadge level={2} />
            <Typography sx={{ mt: 1 }}>Your status is Critical. Contact your flight surgeon now. Don’t wait for a chat reply.</Typography>
            <Button variant="contained" color="error" sx={{ mt: 1.5 }} onClick={() => go('contact')}>Contact flight surgeon</Button>
          </Box>
        </Card>
      )}

      <Card sx={{ p: 2.5 }}>
        {log.length === 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="h4">What would help you today?</Typography>
            <Typography variant="body2" color="text.secondary">Ask about how you’re doing or what to do next.</Typography>
          </Box>
        )}
        <Stack spacing={2} aria-live="polite" sx={{ mb: log.length ? 2 : 0 }}>
          {log.map((m, i) => (
            <Box key={i}>
              <Box sx={{ ml: 'auto', width: 'fit-content', maxWidth: '80%', px: 2, py: 1, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>{m.q}</Box>
              <Box sx={{ mt: 1, width: 'fit-content', maxWidth: '80%', px: 2, py: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography sx={{ whiteSpace: 'pre-wrap' }}>{m.a}</Typography>
                <Typography variant="caption" color="text.secondary">Hygieia · {m.mode}</Typography>
              </Box>
            </Box>
          ))}
          {busy && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }} role="status">
              <CircularProgress size={16} color="inherit" /><Typography variant="body2">Hygieia is answering…</Typography>
            </Stack>
          )}
        </Stack>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {QUESTIONS.map((q) => <Button key={q} size="small" variant="outlined" disabled={busy} onClick={() => ask(q)}>{q}</Button>)}
        </Stack>
        <Box component="form" onSubmit={(e) => { e.preventDefault(); ask(text); }} sx={{ display: 'flex', gap: 1 }}>
          <TextField fullWidth size="small" placeholder="Ask about your health…" value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))}
            slotProps={{ htmlInput: { 'aria-label': 'Ask about your health' } }} />
          <Button type="submit" variant="contained" disabled={busy || !text.trim()}>Ask</Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Not a medical diagnosis. For emergencies contact your flight surgeon.
        </Typography>
      </Card>
    </Stack>
  );
}
