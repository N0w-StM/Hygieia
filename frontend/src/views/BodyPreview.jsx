import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography, useTheme } from '@mui/material';
import { useLive } from '../live.jsx';
import { DataAge, KEY, LevelIcon, Overline, StatusBadge, UI } from '../components/status.jsx';
import { SystemIcon, systemLine } from '../components/systems.jsx';

// Marker position of each system on the schematic figure (viewBox 0 0 200 420).
const SPOT = { brain: [100, 34], heart: [108, 118], blood: [146, 190], muscles: [56, 150], radiation: [100, 205], bones: [118, 318] };

/** Body Preview: schematic SVG figure plus an equivalent list (the design's non-3D fallback). */
export default function BodyPreview({ id, go }) {
  const { records } = useLive();
  const hy = useTheme().hy;
  const rec = records[id];
  const [sel, setSel] = useState('radiation');
  if (!rec) return <Typography color="text.secondary">Waiting for your first reading…</Typography>;
  const systems = rec.systems;
  const cur = systems.find((s) => s.key === sel) || systems[0];
  const fig = { fill: hy.surface2, stroke: hy.border, strokeWidth: 2 };

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>Body overview</Overline>
        <Typography variant="h1">Explore your systems</Typography>
        <Typography variant="body2" color="text.secondary">Select a region or use the list. Both show the same information.</Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 1fr) 1fr' }, alignItems: 'start' }}>
        <Card>
          <CardContent sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <svg viewBox="0 0 200 420" style={{ width: '100%', maxWidth: 300, height: 'auto' }} role="group" aria-label="Body diagram with six selectable systems">
              <ellipse cx="100" cy="205" rx="92" ry="198" fill="none" stroke={hy[KEY[systems.find((s) => s.key === 'radiation').level]]}
                strokeWidth={sel === 'radiation' ? 3 : 1.5} strokeDasharray="6 6" />
              <circle cx="100" cy="38" r="24" {...fig} />
              <rect x="88" y="60" width="24" height="16" {...fig} />
              <rect x="64" y="74" width="72" height="118" rx="18" {...fig} />
              <rect x="40" y="80" width="20" height="112" rx="10" {...fig} />
              <rect x="140" y="80" width="20" height="112" rx="10" {...fig} />
              <rect x="68" y="188" width="28" height="170" rx="13" {...fig} />
              <rect x="104" y="188" width="28" height="170" rx="13" {...fig} />
              {systems.map((s) => {
                const [x, y] = SPOT[s.key];
                const c = hy[KEY[s.level]];
                const on = s.key === sel;
                return (
                  <g key={s.key} tabIndex={0} role="button" aria-pressed={on} aria-label={`${s.name}: ${UI[s.level]}`} style={{ cursor: 'pointer', outline: 'none' }}
                    onClick={() => setSel(s.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(s.key); } }}>
                    <circle cx={x} cy={y} r={on ? 17 : 14} fill={hy.surface} stroke={c} strokeWidth={on ? 3.5 : 2} />
                    <g transform={`translate(${x - 9} ${y - 9})`} style={{ color: c }}><LevelIcon level={s.level} size={18} color={c} /></g>
                  </g>
                );
              })}
            </svg>
          </CardContent>
        </Card>

        <Stack spacing={2}>
          <Card sx={{ borderColor: hy[KEY[cur.level]] }}>
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.5, color: 'text.secondary' }}>
                <SystemIcon k={cur.key} />
                <Typography variant="h3" color="text.primary">{cur.name}</Typography>
              </Stack>
              <StatusBadge level={cur.level} />
              <Typography sx={{ mt: 2 }}>{systemLine(cur)}</Typography>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{cur.metric.label}</Typography>
              <Typography sx={{ fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 28 }}>{cur.metric.value}</Typography>
              {cur.note && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{cur.note}</Typography>}
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 2, flexWrap: 'wrap', gap: 1 }}>
                <Button variant="contained" onClick={() => go('chat')}>Ask AI about this</Button>
                <DataAge scoredAt={rec.scored_at} />
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 1 }}>
              {systems.map((s) => (
                <Box component="li" key={s.key}>
                  <Button fullWidth onClick={() => setSel(s.key)} color="inherit" aria-pressed={s.key === sel}
                    sx={{ justifyContent: 'space-between', px: 2, py: 1.25, bgcolor: s.key === sel ? 'action.selected' : 'transparent' }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                      <SystemIcon k={s.key} /><Typography color="text.primary">{s.name}</Typography>
                    </Stack>
                    <StatusBadge level={s.level} size="small" plain />
                  </Button>
                </Box>
              ))}
            </Stack>
          </Card>
        </Stack>
      </Box>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>{[0, 1, 2].map((l) => <StatusBadge key={l} level={l} size="small" />)}</Stack>
    </Stack>
  );
}
