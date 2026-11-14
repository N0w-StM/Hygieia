import React, { useEffect, useMemo, useState } from 'react';
import { Box, Card, CardContent, Divider, MenuItem, Select, Stack, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { api, ago, missionClock } from '../api.js';
import { useLive, useLiveEvent, useNow } from '../live.jsx';
import { DataAge, LevelStrip, Overline, StatusBadge, UI } from '../components/status.jsx';
import { SystemIcon } from '../components/systems.jsx';
import { AlertRow } from './AlertCentre.jsx';

const METRICS = ['heart_rate', 'hrv_rmssd', 'sbp', 'dbp', 'spo2', 'core_temp', 'sleep_hours', 'mood_score', 'pvt_reaction_ms',
  'co2_mmhg', 'radiation_msv', 'sans_trt_um', 'vo2max', 'fluid_intake_ml'];
const BASELINE = { heart_rate: 'baseline_hr', hrv_rmssd: 'baseline_hrv_rmssd', sbp: 'baseline_sbp', dbp: 'baseline_dbp', spo2: 'baseline_spo2' };
const HZ = [['radiation', 'Radiation'], ['isolation', 'Isolation'], ['distance', 'Distance'], ['gravity', 'Gravity'], ['environment', 'Environment']];
const SOURCE = { 'model:isolation': 'Model: Isolation', 'rule:heart': 'Protocol rule', 'model:environment+rule:spo2': 'Model: Environment + SpO₂ rule',
  'model:gravity': 'Model: Gravity (proxy)', 'model:radiation': 'Model: Radiation' };
const FLAGS = { spe_event: 'solar particle event', illness_flag: 'illness', sleep_deprived: 'sleep deprivation', co2_spike: 'CO₂ spike' };

export default function CrewDetail({ id, go }) {
  const { records, crew, alerts } = useLive();
  const hy = useTheme().hy;
  const now = useNow(5000);
  const rec = records[id];
  const person = crew.find((c) => c.astronaut_id === id);
  const [range, setRange] = useState('7d');
  const [metric, setMetric] = useState('heart_rate');
  const [tel, setTel] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const stamp = rec?.reading_timestamp;

  useEffect(() => {
    let live = true;
    api.get(`/telemetry/${id}`, { range }).then((d) => { if (live) setTel(d); }).catch(() => {});
    return () => { live = false; };
  }, [id, range, stamp]);
  const loadCheckins = () => api.get('/checkin', { astronaut_id: id, limit: 3 }).then((d) => setCheckins(d.checkins)).catch(() => {});
  useEffect(() => { loadCheckins(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveEvent('checkin', (c) => { if (c.astronaut_id === id) loadCheckins(); });

  const chart = useMemo(() => {
    if (!tel) return null;
    const s = tel.series;
    const labels = s.map((p) => (tel.resolution === 'daily' ? `D${p.mission_day}` : `D${p.mission_day} ${p.timestamp.slice(11, 13)}h`));
    return { labels, values: s.map((p) => p[metric]), levels: Object.fromEntries(HZ.map(([k]) => [k, s.map((p) => p[`level_${k}`])])),
      anomaly: s.map((p) => p.anomaly_score) };
  }, [tel, metric]);

  if (!rec || !person) return <Typography color="text.secondary">Waiting for data…</Typography>;
  const sig = tel?.signals?.[metric];
  const base = BASELINE[metric] ? person.baseline[BASELINE[metric]] : null;
  const mine = alerts.filter((a) => a.astronaut_id === id).slice(0, 4);
  const flags = Object.entries(rec.context.dataset_flags).filter(([k, v]) => v && FLAGS[k]).map(([k]) => FLAGS[k]);
  const every = Math.max(1, Math.ceil((chart?.labels.length || 1) / 8));
  const axis = { data: chart?.labels || [], scaleType: 'point', tickInterval: (_, i) => i % every === 0 };

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>Crew member / {id}</Overline>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h1">{person.name}</Typography>
          <StatusBadge level={rec.overall.level} suffix="overall" />
        </Stack>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
          <Typography color="text.secondary">{person.role} · Individual baseline · Reading of day {rec.mission_day}, {missionClock(rec.reading_timestamp)} · {rec.phase.replaceAll('_', ' ')}</Typography>
          <DataAge scoredAt={rec.scored_at} />
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' } }}>
        {rec.systems.map((s) => (
          <Card key={s.key}>
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                  <SystemIcon k={s.key} /><Typography variant="h5" color="text.primary">{s.name}</Typography>
                </Stack>
                <StatusBadge level={s.level} size="small" plain />
              </Stack>
              <Typography sx={{ fontFamily: '"Manrope", sans-serif', fontWeight: 700, fontSize: 26 }}>{s.metric.value}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{s.metric.label}</Typography>
              <Typography variant="caption" color="text.secondary">Status source: {SOURCE[s.source] || s.source}</Typography>
              {s.key === 'heart' && rec.rules.heart.reasons.length > 0 && <Typography variant="body2" sx={{ mt: 0.5 }}>{rec.rules.heart.reasons.join('; ')}</Typography>}
            </CardContent>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
        <Card>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h4" sx={{ mb: 1 }}>Countermeasures</Typography>
            {rec.countermeasures.length === 0 ? <Typography color="text.secondary" variant="body2">No hazard is flagged. No countermeasure is suggested.</Typography> : (
              <Stack spacing={1} component="ol" sx={{ m: 0, pl: 2.5 }}>
                {rec.countermeasures.map((c, i) => (
                  <Typography component="li" key={i} variant="body2" sx={{ fontWeight: i === 0 ? 600 : 400 }}>
                    {c.action} <Typography component="span" variant="caption" color="text.secondary">· {c.hazard}, {UI[c.level === 'RED' ? 2 : 1]}{i === 0 ? ' · shown to the astronaut as the one next action' : ''}</Typography>
                  </Typography>
                ))}
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>Protocol-style suggestions from the model catalog, worst hazard first. Flagged for review, not a diagnosis.</Typography>
          </CardContent>
        </Card>

        <Card>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h4">Model context</Typography>
            <Typography variant="caption" color="text.secondary">Where to look, not why. None of this triggers an alert.</Typography>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="subtitle2">Unusual signals</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
              {rec.unusual_signals.map((u) => (
                <Box key={u.feature}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{u.feature}</Typography>
                  <Typography variant="caption" color="text.secondary">{u.z > 0 ? '+' : ''}{u.z} SD from training mean</Typography>
                </Box>
              ))}
            </Stack>
            <Typography variant="body2">Anomaly score: <b>{rec.anomaly.score}</b> <Typography component="span" variant="caption" color="text.secondary">(lower is more unusual; about a third of recorded readings fall below 0)</Typography></Typography>
            <Typography variant="body2">Overall classifier (diagnostic only): {UI[rec.diagnostics.model_overall_level]}</Typography>
            <Typography variant="body2">Recorded dose so far: {rec.context.cumulative_dose_msv} mSv <Typography component="span" variant="caption" color="text.secondary">(sum of per-reading values; no limit rule applied)</Typography></Typography>
            {flags.length > 0 && <Typography variant="body2">Dataset annotation for this reading: {flags.join(', ')}</Typography>}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Model {rec.model_version} · replay of recorded mission data</Typography>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
            <Typography variant="h4">Trends</Typography>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Select size="small" value={metric} onChange={(e) => setMetric(e.target.value)} inputProps={{ 'aria-label': 'Signal' }}>
                {METRICS.map((m) => <MenuItem key={m} value={m}>{tel?.signals?.[m]?.label || m}</MenuItem>)}
              </Select>
              <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, v) => v && setRange(v)} aria-label="Time range">
                {['24h', '7d', '30d', 'mission'].map((r) => <ToggleButton key={r} value={r}>{r === 'mission' ? 'Mission' : r}</ToggleButton>)}
              </ToggleButtonGroup>
            </Stack>
          </Stack>
          {chart && sig ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {sig.label} ({sig.unit}) · {tel.resolution === 'daily' ? 'daily mean' : '6-hour readings'}{base != null ? ` · dashed line = preflight baseline ${base}` : ''}
              </Typography>
              <LineChart height={260} xAxis={[axis]} yAxis={[{ width: 56 }]} grid={{ horizontal: true }} hideLegend
                series={[{ data: chart.values, label: sig.label, color: hy.primary, showMark: chart.values.length <= 40, curve: 'linear', valueFormatter: (v) => (v == null ? '' : `${v} ${sig.unit}`) }]}>
                {base != null && <ChartsReferenceLine y={base} lineStyle={{ stroke: hy.muted, strokeDasharray: '5 5' }} />}
              </LineChart>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 1 }}>
                Hazard levels over the same period{tel.resolution === 'daily' ? ' (worst reading of each day)' : ''}. Bar height: short Normal, medium Watch, tall Critical.
              </Typography>
              <Stack spacing={1}>
                {HZ.map(([k, label]) => {
                  const hist = chart.levels[k].map((level) => ({ level }));
                  const n = [1, 2].map((l) => hist.filter((h) => h.level === l).length);
                  return (
                    <Box key={k} sx={{ display: 'grid', gridTemplateColumns: { xs: '92px 1fr', sm: '120px 1fr 150px' }, gap: 1.5, alignItems: 'end' }}>
                      <Typography variant="body2">{label}</Typography>
                      <LevelStrip history={hist} hideSummary />
                      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                        {n[0] || n[1] ? `${n[0]} Watch · ${n[1]} Critical` : 'All Normal'}
                      </Typography>
                    </Box>
                  );
                })}
              </Stack>
            </>
          ) : <Typography color="text.secondary">Loading trends…</Typography>}
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
        <Card sx={{ p: 2.5 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="h4">Recent alerts</Typography>
            <Box component="button" onClick={() => go('contact', id)} sx={{ all: 'unset', cursor: 'pointer', color: 'primary.main', fontWeight: 600, fontSize: 14 }}>Message {person.name.split(' ')[0]} →</Box>
          </Stack>
          {mine.length === 0 ? <Typography color="text.secondary" variant="body2">No alerts for this crew member.</Typography>
            : <Stack divider={<Divider />} spacing={2}>{mine.map((a) => <AlertRow key={a.alert_id} alert={a} now={now} canAck compact />)}</Stack>}
        </Card>
        <Card sx={{ p: 2.5 }}>
          <Typography variant="h4" sx={{ mb: 1.5 }}>Self-reported check-ins</Typography>
          {checkins.length === 0 ? <Typography color="text.secondary" variant="body2">No check-in submitted yet.</Typography> : (
            <Stack divider={<Divider />} spacing={1.5}>
              {checkins.map((c) => (
                <Box key={c.checkin_id}>
                  <Typography variant="body2">Sleep {c.sleep_hours ?? '–'} h · Mood {c.mood ?? '–'}/5 · Stress {c.stress ?? '–'}/5 · Exercise {c.exercise_done == null ? '–' : c.exercise_done ? 'done' : 'not done'}</Typography>
                  {c.note && <Typography variant="body2" color="text.secondary">“{c.note}”</Typography>}
                  <Typography variant="caption" color="text.secondary">Day {c.mission_day} · {ago(c.submitted_at, now)} · not a model input</Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Card>
      </Box>
    </Stack>
  );
}
