import React, { useState } from 'react';
import { Box, Button, Card, Chip, Divider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { api, ago, missionClock } from '../api.js';
import { useLive, useNow } from '../live.jsx';
import { Overline, StatusBadge, needsAck, replayClosed } from '../components/status.jsx';

const SOURCE = { model: 'Model alert', rule: 'Protocol rule', astronaut: 'Sent by astronaut' };
const levelOf = (a) => (a.level === 'RED' ? 2 : a.level === 'ORANGE' ? 1 : null);

export function AlertRow({ alert: a, now, compact = false, canAck = false, go }) {
  const { nameOf, doctor, upsertAlert } = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const level = levelOf(a);
  const ack = async () => {
    setBusy(true);
    try { upsertAlert(await api.post(`/alerts/${a.alert_id}/ack`, { acknowledged_by: doctor.name })); setError(''); }
    catch (e) { setError(`Could not acknowledge. ${e.message}`); }
    finally { setBusy(false); }
  };
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' }, opacity: a.status === 'cleared' ? 0.8 : 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5, mb: 0.5 }}>
        {level != null ? <StatusBadge level={level} size="small" /> : <Chip size="small" label="Help requested" color="error" variant="outlined" />}
        <Chip size="small" variant="outlined" label={SOURCE[a.source]} />
        <Chip size="small" variant="outlined" label={a.status === 'active' ? 'Active' : 'Cleared'} />
        <Typography variant="caption" color="text.secondary">{a.alert_id}</Typography>
      </Stack>
      <Typography variant={compact ? 'body2' : 'body1'} sx={{ fontWeight: 600 }}>
        {go ? <Box component="button" onClick={() => go('detail', a.astronaut_id)} sx={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline', '&:focus-visible': { outline: 2 } }}>{nameOf(a.astronaut_id)}</Box> : nameOf(a.astronaut_id)}
        {' · '}<Box component="span" sx={{ fontWeight: 400 }}>{a.message}</Box>
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        Reading of day {a.mission_day}, {missionClock(a.reading_timestamp)} · raised {ago(a.triggered_at, now)}
        {a.status === 'cleared' ? ` · cleared ${ago(a.cleared_at, now)}${replayClosed(a) ? ' (replay moved)' : ''}` : ''}
      </Typography>
      {a.acknowledged_at
        ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>✓ Acknowledged by {a.acknowledged_by} {ago(a.acknowledged_at, now)}</Typography>
        : !canAck && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Not yet acknowledged by the medical officer</Typography>}
      {error && <Typography variant="caption" color="error" role="alert" sx={{ display: 'block' }}>{error}</Typography>}
      </Box>
      {canAck && needsAck(a) && (
        <Button size="small" variant="outlined" disabled={busy} onClick={ack} sx={{ flex: 'none' }}>{busy ? 'Saving…' : 'Acknowledge'}</Button>
      )}
    </Box>
  );
}

/** Doctor notification centre: astronaut alerts + model/rule alerts, with acknowledge. */
export default function AlertCentre({ go }) {
  const { alerts } = useLive();
  const now = useNow(5000);
  const [filter, setFilter] = useState('unack');
  const shown = alerts.filter((a) => (filter === 'unack' ? needsAck(a) : filter === 'active' ? a.status === 'active' : true));
  const unack = alerts.filter(needsAck).length;
  return (
    <Stack spacing={3}>
      <Box>
        <Overline>Notification centre</Overline>
        <Typography variant="h1">Alerts</Typography>
        <Typography variant="body2" color="text.secondary">
          {unack} need acknowledging, {alerts.length} in total. Acknowledging records that you have seen an alert. It never changes the risk status.
        </Typography>
      </Box>
      <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} aria-label="Filter alerts">
        <ToggleButton value="unack">To acknowledge</ToggleButton>
        <ToggleButton value="active">Active</ToggleButton>
        <ToggleButton value="all">All</ToggleButton>
      </ToggleButtonGroup>
      <Card sx={{ p: 2.5 }}>
        {shown.length === 0
          ? <Typography color="text.secondary">No alerts in this view.</Typography>
          : <Stack divider={<Divider />} spacing={2}>{shown.slice(0, 100).map((a) => <AlertRow key={a.alert_id} alert={a} now={now} canAck go={go} />)}</Stack>}
      </Card>
      <Typography variant="caption" color="text.secondary">
        Model alerts: Critical is raised at once; Watch only after two consecutive 6-hour readings; alerts clear after two consecutive lower readings.
      </Typography>
    </Stack>
  );
}
