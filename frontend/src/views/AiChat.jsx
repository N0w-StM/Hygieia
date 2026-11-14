import React, { useState } from 'react';
import { Box, Button, Card, Chip, Stack, TextField, Typography } from '@mui/material';
import { useLive } from '../live.jsx';
import { Overline, StatusBadge, UI } from '../components/status.jsx';

// OFFLINE DEMO ANSWERS: fixed templates filled from the astronaut's current status.
// No language model runs here. (Ollama is a stretch goal; see README.)
const QUESTIONS = ['How am I doing today?', 'Why is my status flagged?', 'How did I sleep?', 'What should I do now?'];

function answer(q, rec) {
  const s = rec.astronaut_summary;
  const flagged = rec.systems.filter((x) => x.level > 0).map((x) => `${x.name} (${UI[x.level]})`);
  const t = q.toLowerCase();
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
  if (!rec) return <Typography color="text.secondary">Waiting for your first reading…</Typography>;
  const critical = rec.astronaut_summary.level === 2;
  const ask = (q) => { const v = q.trim(); if (v) { setLog((l) => [...l, { q: v, a: answer(v, rec), level: rec.astronaut_summary.level }]); setText(''); } };

  return (
    <Stack spacing={2}>
      <Box>
        <Overline>Hygieia health assistant</Overline>
        <Typography variant="h1">Your status. In plain language.</Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Chip label="Offline demo answers" color="primary" variant="outlined" />
          <Typography variant="body2" color="text.secondary">Fixed replies built from your latest reading. No AI model is running.</Typography>
        </Stack>
      </Box>

      {critical && (
        <Card sx={(t) => ({ borderColor: t.hy.critical })}>
          <Box sx={{ p: 2.5 }} role="alert">
            <StatusBadge level={2} />
            <Typography sx={{ mt: 1 }}>Your status is Critical. Contact your flight surgeon now. Don't wait for a chat reply.</Typography>
            <Button variant="contained" color="error" sx={{ mt: 1.5 }} onClick={() => go('contact')}>Contact flight surgeon</Button>
          </Box>
        </Card>
      )}

      <Card sx={{ p: 2.5 }}>
        {log.length === 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="h4">What would help you today?</Typography>
            <Typography variant="body2" color="text.secondary">Ask about how you're doing or what to do next.</Typography>
          </Box>
        )}
        <Stack spacing={2} aria-live="polite" sx={{ mb: log.length ? 2 : 0 }}>
          {log.map((m, i) => (
            <Box key={i}>
              <Box sx={{ ml: 'auto', width: 'fit-content', maxWidth: '80%', px: 2, py: 1, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>{m.q}</Box>
              <Box sx={{ mt: 1, width: 'fit-content', maxWidth: '80%', px: 2, py: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                <Typography>{m.a}</Typography>
                <Typography variant="caption" color="text.secondary">Hygieia · offline demo answer</Typography>
              </Box>
            </Box>
          ))}
        </Stack>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {QUESTIONS.map((q) => <Button key={q} size="small" variant="outlined" onClick={() => ask(q)}>{q}</Button>)}
        </Stack>
        <Box component="form" onSubmit={(e) => { e.preventDefault(); ask(text); }} sx={{ display: 'flex', gap: 1 }}>
          <TextField fullWidth size="small" placeholder="Ask about your health…" value={text} onChange={(e) => setText(e.target.value.slice(0, 300))}
            slotProps={{ htmlInput: { 'aria-label': 'Ask about your health' } }} />
          <Button type="submit" variant="contained" disabled={!text.trim()}>Ask</Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Not a medical diagnosis. For emergencies contact your flight surgeon.
        </Typography>
      </Card>
    </Stack>
  );
}
