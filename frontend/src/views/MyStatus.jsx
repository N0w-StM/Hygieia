import React, { useState } from 'react';
import {
  Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Slider, Stack, Switch,
  TextField, Typography,
} from '@mui/material';
import CampaignOutlined from '@mui/icons-material/CampaignOutlined';
import { api, ago } from '../api.js';
import { useLive, useNow } from '../live.jsx';
import { DataAge, Overline, StatusBadge, useLevelColors } from '../components/status.jsx';
import { SystemIcon, systemLine } from '../components/systems.jsx';

export default function MyStatus({ id, go }) {
  const { records, alerts, doctor } = useLive();
  const rec = records[id];
  const [sendOpen, setSendOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [openTile, setOpenTile] = useState(null);
  const now = useNow(5000);
  if (!rec) return <Typography color="text.secondary">Waiting for your first reading…</Typography>;
  const sum = rec.astronaut_summary;
  const lastSent = alerts.find((a) => a.source === 'astronaut' && a.astronaut_id === id);

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>Your health today</Overline>
        <Typography variant="h1">Am I okay?</Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <StatusBadge level={sum.level} />
            <DataAge scoredAt={rec.scored_at} />
          </Stack>
          <Typography variant="h2" sx={{ mb: 0.5 }}>{sum.title}</Typography>
          <Typography color="text.secondary">{sum.body}</Typography>
        </CardContent>
      </Card>

      {sum.next_action && <ActionCard level={sum.level} text={sum.next_action.text} go={go} />}

      <Box>
        <Typography variant="h4">Your systems</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Select a system for a plain-language update.</Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
          {rec.systems.map((s) => (
            <Card key={s.key} component="button" onClick={() => setOpenTile(openTile === s.key ? null : s.key)} aria-expanded={openTile === s.key}
              sx={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', p: 0, '&:focus-visible': { outline: 2, outlineColor: 'primary.main' } }}>
              <CardContent sx={{ p: 2.5 }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', color: 'text.secondary', mb: 1.5 }}>
                  <SystemIcon k={s.key} />
                  <Typography variant="h5" color="text.primary">{s.name}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">{s.metric.label}</Typography>
                <Typography sx={{ fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 26, mb: 1.5 }}>{s.metric.value}</Typography>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <StatusBadge level={s.level} size="small" />
                  <Typography variant="caption" color="text.secondary">{openTile === s.key ? 'Hide' : 'View system →'}</Typography>
                </Stack>
                {openTile === s.key && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                    {systemLine(s)}{s.note ? ` ${s.note}` : ''}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>

      <Card>
        <CardContent sx={{ p: 3, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="h4">Need help?</Typography>
            <Typography variant="body2" color="text.secondary">
              Send Alert notifies {doctor.name} straight away.
            </Typography>
            {lastSent && (
              <Typography variant="body2" sx={{ mt: 1 }} role="status">
                Last alert sent {ago(lastSent.triggered_at, now)} · {lastSent.acknowledged_at ? `Seen by ${lastSent.acknowledged_by}` : 'Waiting to be seen'}
              </Typography>
            )}
          </Box>
          <Button variant="outlined" onClick={() => setCheckOpen(true)}>Daily check-in</Button>
          <Button variant="contained" color="error" size="large" startIcon={<CampaignOutlined />} onClick={() => setSendOpen(true)}>Send Alert</Button>
        </CardContent>
      </Card>

      <SendAlertDialog open={sendOpen} onClose={() => setSendOpen(false)} id={id} doctorName={doctor.name} />
      <CheckinDialog open={checkOpen} onClose={() => setCheckOpen(false)} id={id} />
    </Stack>
  );
}

function ActionCard({ level, text, go }) {
  const { fg } = useLevelColors(level);
  return (
    <Card sx={{ borderColor: fg }}>
      <CardContent sx={{ p: 3 }}>
        <Typography variant="h4">Action needed</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{text}</Typography>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button variant="contained" onClick={() => go('chat')}>Ask AI</Button>
          <Button variant="outlined" color="error" onClick={() => go('contact')}>Contact flight surgeon</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

const QUICK = ['I feel unwell', 'I am short of breath', 'I am in pain', 'I need to talk'];

function SendAlertDialog({ open, onClose, id, doctorName }) {
  const { upsertAlert } = useLive();
  const [text, setText] = useState('');
  const [state, setState] = useState({ busy: false, error: '', sent: false });
  const close = () => { setText(''); setState({ busy: false, error: '', sent: false }); onClose(); };
  const send = async () => {
    setState({ busy: true, error: '', sent: false });
    try {
      upsertAlert(await api.post('/alerts', { astronaut_id: id, message: text }));
      setState({ busy: false, error: '', sent: true });
    } catch (e) {
      setState({ busy: false, error: `Could not send. ${e.message}. Try again or call the medical officer directly.`, sent: false });
    }
  };
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>{state.sent ? 'Alert sent' : 'Send Alert'}</DialogTitle>
      <DialogContent>
        {state.sent ? (
          <Typography role="status">{doctorName} has been notified. You will see here when the alert has been seen.</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">This goes to {doctorName} now. Add a few words if you can.</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {QUICK.map((q) => <Button key={q} size="small" variant={text === q ? 'contained' : 'outlined'} onClick={() => setText(q)}>{q}</Button>)}
            </Stack>
            <TextField label="What is happening? (optional)" multiline minRows={2} value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} />
            {state.error && <Typography color="error" variant="body2" role="alert">{state.error}</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>{state.sent ? 'Close' : 'Cancel'}</Button>
        {!state.sent && <Button variant="contained" color="error" disabled={state.busy} onClick={send}>{state.busy ? 'Sending…' : 'Send Alert'}</Button>}
      </DialogActions>
    </Dialog>
  );
}

function CheckinDialog({ open, onClose, id }) {
  const [f, setF] = useState({ sleep_hours: 7, mood: 3, stress: 3, exercise_done: false, note: '' });
  const [state, setState] = useState({ busy: false, error: '', sent: false });
  const close = () => { setState({ busy: false, error: '', sent: false }); onClose(); };
  const save = async () => {
    setState({ busy: true, error: '', sent: false });
    try { await api.post('/checkin', { astronaut_id: id, ...f }); setState({ busy: false, error: '', sent: true }); }
    catch (e) { setState({ busy: false, error: `Could not save. ${e.message}`, sent: false }); }
  };
  const slider = (key, label, min, max, step, marks) => (
    <Box>
      <Typography variant="body2" id={`ci-${key}`}>{label}: <b>{f[key]}</b></Typography>
      <Slider aria-labelledby={`ci-${key}`} value={f[key]} min={min} max={max} step={step} marks={marks} onChange={(_, v) => setF({ ...f, [key]: v })} />
    </Box>
  );
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Daily check-in</DialogTitle>
      <DialogContent>
        {state.sent ? <Typography role="status">Saved. Your medical officer can see this check-in.</Typography> : (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {slider('sleep_hours', 'Sleep last night (hours)', 0, 12, 0.5)}
            {slider('mood', 'Mood (1 low, 5 good)', 1, 5, 1, true)}
            {slider('stress', 'Stress (1 calm, 5 high)', 1, 5, 1, true)}
            <FormControlLabel control={<Switch checked={f.exercise_done} onChange={(e) => setF({ ...f, exercise_done: e.target.checked })} />} label="Exercise done today" />
            <TextField label="Anything to add? (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value.slice(0, 1000) })} />
            <Typography variant="caption" color="text.secondary">Your answers are shared with your medical officer. They do not change your status.</Typography>
            {state.error && <Typography color="error" variant="body2" role="alert">{state.error}</Typography>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close}>{state.sent ? 'Close' : 'Cancel'}</Button>
        {!state.sent && <Button variant="contained" disabled={state.busy} onClick={save}>Save</Button>}
      </DialogActions>
    </Dialog>
  );
}
