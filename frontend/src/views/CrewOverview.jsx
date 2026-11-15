import React from 'react';
import { Box, ButtonBase, Card, Divider, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery } from '@mui/material';
import { useLive, useNow } from '../live.jsx';
import { DataAge, Overline, StatusBadge, needsAck } from '../components/status.jsx';
import { AlertRow } from './AlertCentre.jsx';

const HZ = [['radiation', 'Radiation'], ['isolation', 'Isolation'], ['distance', 'Distance'], ['gravity', 'Gravity'], ['environment', 'Environment']];

/** Crew triage matrix: every crew member against the five hazards, worst first. */
export default function CrewOverview({ go }) {
  const { crew, records, alerts, replay } = useLive();
  const now = useNow(5000);
  const rows = crew.map((c) => ({ c, r: records[c.astronaut_id] })).filter((x) => x.r)
    .sort((a, b) => b.r.overall.level - a.r.overall.level || a.c.astronaut_id.localeCompare(b.c.astronaut_id));
  const counts = [2, 1, 0].map((l) => rows.filter((x) => x.r.overall.level === l).length);
  // Priority: still active first, then Critical and help requests, then Watch; newest first within each.
  const rank = (a) => (a.status === 'active' ? 10 : 0) + (a.level === 'RED' || a.source === 'astronaut' ? 2 : a.level === 'ORANGE' ? 1 : 0);
  const open = alerts.filter(needsAck).sort((x, y) => rank(y) - rank(x) || (x.triggered_at < y.triggered_at ? 1 : -1));
  const first = rows[0]?.r;
  const phone = useMediaQuery((t) => t.breakpoints.down('md')); // cards below 900px: the 13-column table needs a wide screen

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

      {phone ? (
        <Stack spacing={1.5} component="ul" aria-label="Crew triage list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {rows.map(({ c, r }) => {
            const flagged = HZ.filter(([k]) => r.hazards[k].level > 0);
            const toAck = alerts.filter((a) => a.astronaut_id === c.astronaut_id && needsAck(a)).length;
            return (
              <Card component="li" key={c.astronaut_id}>
                <ButtonBase onClick={() => go('detail', c.astronaut_id)} sx={{ display: 'block', width: '100%', textAlign: 'left', p: 2 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2">{c.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{c.role}</Typography>
                    </Box>
                    <StatusBadge level={r.overall.level} size="small" />
                  </Stack>
                  <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
                    {flagged.length === 0
                      ? <Typography variant="body2" color="text.secondary">All five hazards Normal</Typography>
                      : flagged.map(([k, l]) => <StatusBadge key={k} level={r.hazards[k].level} size="small" plain suffix={`· ${l}`} />)}
                    {r.rules.heart.level > 0 && <StatusBadge level={r.rules.heart.level} size="small" plain suffix="· Heart rule" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    HR {Math.round(r.vitals.heart_rate)} bpm · SpO₂ {r.vitals.spo2.toFixed(1)}% · Sleep {r.vitals.sleep_hours.toFixed(1)} h{toAck ? ` · ${toAck} to acknowledge` : ''}
                  </Typography>
                </ButtonBase>
              </Card>
            );
          })}
        </Stack>
      ) : (
      <Card>
        <TableContainer>
          <Table size="small" aria-label="Crew triage matrix" sx={{ '& td, & th': { whiteSpace: 'nowrap', px: 1.25 }, '& td:first-of-type, & th:first-of-type': { pl: 2 } }}>
            <TableHead>
              <TableRow>
                <TableCell>Crew member</TableCell>
                <TableCell>Overall</TableCell>
                {HZ.map(([k, l]) => <TableCell key={k}>{l}</TableCell>)}
                <TableCell>Heart rule</TableCell>
                <TableCell align="right">HR</TableCell>
                <TableCell align="right">SpO₂</TableCell>
                <TableCell align="right">Sleep</TableCell>
                <TableCell align="right">To ack</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ c, r }) => {
                const mine = alerts.filter((a) => a.astronaut_id === c.astronaut_id && needsAck(a));
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
      )}
      <Typography variant="caption" color="text.secondary">
        Select a row for detail. Overall = worst of the five hazards. Hazard columns are model outputs for the latest 6-hour reading; Heart rule is a check on HR, HRV and blood pressure that uses placeholder demo thresholds, not a validated medical protocol. “Flagged for review”, not a diagnosis.
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
