import React, { useState } from 'react';
import { Box, Button, Chip, Collapse, IconButton, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import PauseRounded from '@mui/icons-material/PauseRounded';
import SkipNextRounded from '@mui/icons-material/SkipNextRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { prefs, useLive } from '../live.jsx';

const SPEEDS = [1, 2, 5, 10, 30];

/** Demo tooling: jump the replay to real recorded windows. No readings are altered. */
export default function ScenarioBar({ setSubjectId, bottomOffset = 0, defaultOpen = true }) {
  const { replay, scenarios, control } = useLive();
  const [open, setOpen] = useState(() => prefs.get('scenarioBar', defaultOpen));
  const [error, setError] = useState('');
  if (!replay) return null;
  const run = (fn) => fn().then(() => setError('')).catch((e) => setError(e.message));
  const toggle = () => { prefs.set('scenarioBar', !open); setOpen(!open); };
  const active = scenarios.find((s) => s.id === replay.scenario);

  return (
    <Box className="no-print" sx={{ position: 'fixed', left: { xs: 0, md: 248 }, right: 0, bottom: bottomOffset, zIndex: 15,
      bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', px: { xs: 1.5, md: 3 }, py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Tooltip title={replay.playing ? 'Pause replay' : 'Play replay'}>
          <IconButton color="primary" aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
            onClick={() => run(() => control(replay.playing ? 'pause' : 'play'))}>
            {replay.playing ? <PauseRounded /> : <PlayArrowRounded />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Advance one 6-hour reading">
          <span><IconButton aria-label="Step one reading" disabled={replay.at_end} onClick={() => run(() => control('step'))}><SkipNextRounded /></IconButton></span>
        </Tooltip>
        <Select size="small" value={SPEEDS.includes(replay.seconds_per_slot) ? replay.seconds_per_slot : ''} displayEmpty
          onChange={(e) => run(() => control('speed', { seconds_per_slot: e.target.value }))}
          inputProps={{ 'aria-label': 'Replay speed' }} sx={{ minWidth: 150, fontSize: 13 }}
          renderValue={(v) => `1 reading / ${v || replay.seconds_per_slot} s`}>
          {SPEEDS.map((s) => <MenuItem key={s} value={s}>1 reading / {s} s</MenuItem>)}
        </Select>
        <Box sx={{ minWidth: 0, mr: 'auto' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Replay of recorded mission data · Day {replay.mission_day}, {String(replay.sample_id * 6).padStart(2, '0')}:00
            {replay.at_end ? ' · end of recording' : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {active ? `Scenario: ${active.label}` : 'Real model output on recorded readings. Nothing is simulated or altered.'}
          </Typography>
        </Box>
        <Button size="small" onClick={toggle} endIcon={open ? <ExpandMoreRounded /> : <ExpandLessRounded />} aria-expanded={open}>
          Scenarios
        </Button>
      </Stack>
      <Collapse in={open}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, py: 1 }}>
          {scenarios.map((s) => (
            <Tooltip key={s.id} title={`${s.description} Starts on day ${s.start.mission_day}.`}>
              <Chip label={s.label} clickable variant={replay.scenario === s.id ? 'filled' : 'outlined'}
                color={replay.scenario === s.id ? 'primary' : 'default'}
                onClick={() => run(async () => { await control('jump', { scenario: s.id }); setSubjectId(s.focus_astronaut); })} />
            </Tooltip>
          ))}
        </Stack>
        {error && <Typography variant="caption" color="error">{error}</Typography>}
      </Collapse>
    </Box>
  );
}
