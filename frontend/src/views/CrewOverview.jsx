import React from 'react';
import { Box, Card, Divider, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useLive, useNow } from '../live.jsx';
import { DataAge, Overline, StatusBadge } from '../components/status.jsx';
import { AlertRow } from './AlertCentre.jsx';

const HZ = [['radiation', 'Radiation'], ['isolation', 'Isolation'], ['distance', 'Distance'], ['gravity', 'Gravity'], ['environment', 'Environment']];

/** Crew triage matrix: every crew member against the five hazards, worst first. */
export default function CrewOverview({ go }) {
  const { crew, records, alerts, replay } = useLive();
  const now = useNow(5000);
  const rows = crew.map((c) => ({ c, r: records[c.astronaut_id] })).filter((x) => x.r)
    .sort((a, b) => b.r.overall.level - a.r.overall.level || a.c.astronaut_id.localeCompare(b.c.astronaut_id));
  const counts = [2, 1, 0].map((l) => rows.filter((x) => x.r.overall.level === l).length);
  const open = alerts.filter((a) => !a.acknowledged_at);
  const first = rows[0]?.r;

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>Mission day {replay?.mission_day} / crew health</Overline>
        <Typography variant="h1">A clear view of crew health.</Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography color="text.secondary">{rows.length} crew · {counts[0]} critical · {counts[1]} watch · {counts[2]} normal</Typography>
          {first && <DataAge scoredAt={first.scored_at} />}
        </Stack>
      </Box>

      <Card>
        <TableContainer>
          <Table size="small" aria-label="Crew triage matrix">
            <TableHead>
              <TableRow>
                <TableCell>Crew member</TableCell>
                <TableCell>Overall<br /><Typography component="span" variant="caption" color="text.secondary">worst hazard</Typography></TableCell>
                {HZ.map(([k, l]) => <TableCell key={k}>{l}</TableCell>)}
                <TableCell>Heart<br /><Typography component="span" variant="caption" color="text.secondary">protocol rule</Typography></TableCell>
                <TableCell align="right">HR</TableCell>
                <TableCell align="right">SpO₂</TableCell>
                <TableCell align="right">Sleep</TableCell>
                <TableCell align="right">Open alerts</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ c, r }) => {
                const mine = alerts.filter((a) => a.astronaut_id === c.astronaut_id && (a.status === 'active' && !a.acknowledged_at));
                return (
                  <TableRow key={c.astronaut_id} hover tabIndex={0} sx={{ cursor: 'pointer' }} onClick={() => go('detail', c.astronaut_id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') go('detail', c.astronaut_id); }}>
                    <TableCell>
                      <Typography variant="subtitle2">{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{c.role}</Typography>
                    </TableCell>
                    <TableCell><StatusBadge level={r.overall.level} size="small" /></TableCell>
                    {HZ.map(([k]) => <TableCell key={k}><StatusBadge level={r.hazards[k].level} size="small" plain /></TableCell>)}
                    <TableCell><StatusBadge level={r.rules.heart.level} size="small" plain /></TableCell>
                    <TableCell align="right">{Math.round(r.vitals.heart_rate)} bpm</TableCell>
                    <TableCell align="right">{r.vitals.spo2.toFixed(1)}%</TableCell>
                    <TableCell align="right">{r.vitals.sleep_hours.toFixed(1)} h</TableCell>
                    <TableCell align="right">{mine.length || '–'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Typography variant="caption" color="text.secondary">
        Select a row for detail. Hazard columns are model outputs for the latest 6-hour reading; "flagged for review", not a diagnosis.
      </Typography>

      <Card sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography variant="h4">Priority alerts</Typography>
          <Box component="button" onClick={() => go('alerts')} sx={{ all: 'unset', cursor: 'pointer', color: 'primary.main', fontWeight: 600, fontSize: 14 }}>View all →</Box>
        </Stack>
        {open.length === 0
          ? <Typography color="text.secondary" variant="body2">No unacknowledged alerts.</Typography>
          : <Stack divider={<Divider />} spacing={2}>{open.slice(0, 4).map((a) => <AlertRow key={a.alert_id} alert={a} now={now} canAck go={go} compact />)}</Stack>}
      </Card>
    </Stack>
  );
}
