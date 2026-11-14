import React, { useEffect, useState } from 'react';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { api, missionClock } from '../api.js';
import { useLive } from '../live.jsx';
import { DataAge, LevelStrip, Overline, StatusBadge } from '../components/status.jsx';

const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

/** The 5 Hazards tab: fully model-driven (one model output per NASA hazard). */
export default function Hazards({ id, view }) {
  const { records, nameOf } = useLive();
  const stamp = records[id]?.reading_timestamp;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/hazards/${id}`, { view }).then((d) => { if (live) { setData(d); setError(''); } })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [id, view, stamp]);

  if (error && !data) return <Typography color="error">Could not load hazards. {error}</Typography>;
  if (!data) return <Typography color="text.secondary">Loading hazards…</Typography>;
  const flagged = data.hazards.filter((h) => h.level > 0).length;

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>NASA's five hazards of human spaceflight</Overline>
        <Typography variant="h1">{view === 'doctor' ? `${nameOf(id)}: hazard status` : 'Your five hazards'}</Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <StatusBadge level={data.overall.level} suffix="overall" />
          <Typography variant="body2" color="text.secondary">
            {flagged === 0 ? 'No hazard is flagged.' : `${flagged} of 5 flagged for review.`} Reading of day {data.mission_day}, {missionClock(data.reading_timestamp)}.
          </Typography>
          <DataAge scoredAt={data.scored_at} />
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        {data.hazards.map((h) => (
          <Card key={h.key}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1 }}>
                <Box>
                  <Typography variant="h4">{h.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{h.about}</Typography>
                </Box>
                <StatusBadge level={h.level} />
              </Stack>
              <Typography sx={{ mb: 2 }}>{h.status_copy}</Typography>

              {h.signals.length > 0 ? (
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3, mb: 2 }}>
                  {h.signals.map((s) => (
                    <Box key={s.key}>
                      <Typography variant="caption" color="text.secondary">{s.label}</Typography>
                      <Typography sx={{ fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 20 }}>
                        {fmt(s.value)} <Typography component="span" variant="caption" color="text.secondary">{s.unit}</Typography>
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  No single signal: this hazard combines several readings.
                </Typography>
              )}

              <LevelStrip history={h.history} />

              {view === 'astronaut' && h.next_action && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2">What to do</Typography>
                  <Typography variant="body2">{h.next_action}</Typography>
                </>
              )}
              {view === 'doctor' && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2">Countermeasures</Typography>
                  {h.countermeasures.length === 0
                    ? <Typography variant="body2" color="text.secondary">None at Normal.</Typography>
                    : <Box component="ol" sx={{ m: 0, pl: 2.5 }}>{h.countermeasures.map((c) => <Typography component="li" variant="body2" key={c}>{c}</Typography>)}</Box>}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Model note: {h.caveat}</Typography>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Each status is the model's reading of one 6-hour health snapshot. A Watch or Critical status means "flagged for review".
      </Typography>
    </Stack>
  );
}
