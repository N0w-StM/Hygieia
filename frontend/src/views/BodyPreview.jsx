import React, { Component, Suspense, lazy, useState } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useLive } from '../live.jsx';
import { DataAge, KEY, LevelIcon, Overline, StatusBadge, UI } from '../components/status.jsx';
import { SystemIcon, systemLine } from '../components/systems.jsx';

// Loaded only when this tab renders with WebGL available, so three.js stays out of the main bundle.
const Body3D = lazy(() => import('./Body3D.jsx'));

// Marker position of each system on the schematic figure (viewBox 0 0 200 420).
const SPOT = { brain: [100, 34], heart: [108, 118], blood: [146, 190], muscles: [56, 150], radiation: [100, 205], bones: [118, 318] };

let webglCache = null;
function hasWebGL() {
  if (webglCache == null) {
    try {
      const c = document.createElement('canvas');
      const gl = window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'));
      webglCache = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context
    } catch { webglCache = false; }
  }
  return webglCache;
}

/** Any error in the 3D view (renderer creation, lost context, chunk load) falls back to the SVG figure. */
class Fallback3D extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('[Hygieia] 3D body preview unavailable, showing the 2D figure:', err?.message || err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const doctorLine = (s) => ['Within usual range.', 'Flagged for review.', 'Flagged for review now.'][s.level];

/**
 * Body Preview: 3D figure (or the schematic SVG when WebGL is unavailable) plus an equivalent list.
 * view = "astronaut" (their own record) or "doctor" (the selected crew member). Same records as the
 * rest of each view, so no extra data is requested here.
 */
export default function BodyPreview({ id, go, view = 'astronaut' }) {
  const { records, nameOf } = useLive();
  const hy = useTheme().hy;
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const rec = records[id];
  const [sel, setSel] = useState('radiation');
  if (!rec) return <Typography color="text.secondary">{view === 'doctor' ? 'Waiting for a reading…' : 'Waiting for your first reading…'}</Typography>;
  const systems = rec.systems;
  const cur = systems.find((s) => s.key === sel) || systems[0];
  const svg = <BodySvg systems={systems} sel={sel} setSel={setSel} hy={hy} />;
  const line = view === 'doctor' ? doctorLine : systemLine;

  return (
    <Stack spacing={3}>
      <Box>
        <Overline>{view === 'doctor' ? `Body overview / ${nameOf(id)}` : 'Body overview'}</Overline>
        <Typography variant="h1">{view === 'doctor' ? 'Body systems' : 'Explore your systems'}</Typography>
        <Typography variant="body2" color="text.secondary">
          Select a region or use the list. Both show the same information.{hasWebGL() ? ' Drag the figure to turn it.' : ''}
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 1fr) 1fr' }, alignItems: 'start' }}>
        <Card>
          <CardContent sx={{ display: 'flex', justifyContent: 'center', p: hasWebGL() ? 1 : 2, '&:last-child': { pb: hasWebGL() ? 1 : 2 } }}>
            {hasWebGL() ? (
              <Fallback3D fallback={svg}>
                <Suspense fallback={svg}>
                  <Body3D systems={systems} sel={sel} onPick={setSel} hy={hy} reduced={reduced} />
                </Suspense>
              </Fallback3D>
            ) : svg}
          </CardContent>
        </Card>

        <Stack spacing={2}>
          <Card sx={{ borderColor: hy[KEY[cur.level]] }} aria-live="polite">
            <CardContent sx={{ p: 3 }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 1.5, color: 'text.secondary' }}>
                <SystemIcon k={cur.key} />
                <Typography variant="h3" color="text.primary">{cur.name}</Typography>
              </Stack>
              <StatusBadge level={cur.level} />
              <Typography sx={{ mt: 2 }}>{line(cur)}</Typography>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{cur.metric.label}</Typography>
              <Typography sx={{ fontFamily: '"Manrope", sans-serif', fontWeight: 600, fontSize: 28 }}>{cur.metric.value}</Typography>
              {cur.note && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{cur.note}</Typography>}
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 2, flexWrap: 'wrap', gap: 1 }}>
                {view === 'doctor'
                  ? <Button variant="contained" onClick={() => go('detail')}>Open crew member</Button>
                  : <Button variant="contained" onClick={() => go('chat')}>Ask AI about this</Button>}
                <DataAge scoredAt={rec.scored_at} />
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 1 }} aria-label="Body systems">
              {systems.map((s) => (
                <Box component="li" key={s.key}>
                  <Button fullWidth onClick={() => setSel(s.key)} color="inherit" aria-pressed={s.key === sel}
                    sx={{ justifyContent: 'space-between', px: 2, py: 1.25, bgcolor: s.key === sel ? 'action.selected' : 'transparent' }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary', textAlign: 'left' }}>
                      <SystemIcon k={s.key} />
                      <Box>
                        <Typography color="text.primary">{s.name}</Typography>
                        {s.proxy && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Status follows the Gravity hazard</Typography>}
                      </Box>
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

/** Schematic 2D figure: the fallback when WebGL is unavailable or the 3D view fails. */
function BodySvg({ systems, sel, setSel, hy }) {
  const fig = { fill: hy.surface2, stroke: hy.border, strokeWidth: 2 };
  return (
    <svg viewBox="0 0 200 420" style={{ width: '100%', maxWidth: 300, height: 'auto' }} role="group" aria-label="Body diagram with six selectable systems" data-testid="body-svg">
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
            <title>{`${s.name}: ${UI[s.level]}`}</title>
            <circle cx={x} cy={y} r={on ? 17 : 14} fill={hy.surface} stroke={c} strokeWidth={on ? 3.5 : 2} />
            <g transform={`translate(${x - 9} ${y - 9})`} style={{ color: c }}><LevelIcon level={s.level} size={18} color={c} /></g>
          </g>
        );
      })}
    </svg>
  );
}
