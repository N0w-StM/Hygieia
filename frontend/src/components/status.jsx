import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { ago } from '../api.js';
import { useNow } from '../live.jsx';

export const UI = ['Normal', 'Watch', 'Critical'];
export const KEY = ['normal', 'watch', 'critical'];
/** Alerts closed only because the demo replay jumped do not need anyone's attention. */
export const replayClosed = (a) => a.status === 'cleared' && /^replay_/.test(a.cleared_reason || '');
export const needsAck = (a) => !a.acknowledged_at && !replayClosed(a);

export const DISCLAIMER = 'For monitoring and research purposes, not a medical diagnosis.';

/** Status shape: check-circle (Normal), triangle (Watch), octagon (Critical). Never colour alone. */
export function LevelIcon({ level, size = 18, color }) {
  const s = { width: size, height: size, flex: 'none', display: 'block' };
  const p = { fill: 'none', stroke: color || 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (level === 2) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} style={s} aria-hidden="true">
        <path {...p} d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z" />
        <path {...p} d="M12 7.5v5.5M12 16.4v.1" />
      </svg>
    );
  }
  if (level === 1) {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} style={s} aria-hidden="true">
        <path {...p} d="M12 3.5 22 20.5H2z" />
        <path {...p} d="M12 10v4.5M12 17.4v.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={s} aria-hidden="true">
      <circle {...p} cx="12" cy="12" r="9.2" />
      <path {...p} d="m7.8 12.3 2.9 2.9 5.5-6" />
    </svg>
  );
}

export function useLevelColors(level) {
  const t = useTheme().hy;
  const k = KEY[level] || 'normal';
  return { fg: t[k], bg: t[`${k}Bg`] };
}

/** Word + shape + colour badge. */
export function StatusBadge({ level = 0, size = 'medium', plain = false, suffix }) {
  const { fg, bg } = useLevelColors(level);
  const small = size === 'small';
  return (
    <Box component="span" role="status" aria-label={`Status: ${UI[level]}`}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: fg, fontWeight: 600,
        fontSize: small ? 13 : 14, whiteSpace: 'nowrap', borderRadius: 1.5,
        ...(plain ? {} : { bgcolor: bg, px: small ? 1 : 1.5, py: small ? 0.25 : 0.75 }) }}>
      <LevelIcon level={level} size={small ? 15 : 18} />
      {UI[level]}{suffix ? ` ${suffix}` : ''}
    </Box>
  );
}

export function DataAge({ scoredAt, prefix = 'Updated' }) {
  const now = useNow();
  if (!scoredAt) return null;
  const stale = now - Date.parse(scoredAt) > 120000;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
      {prefix} {ago(scoredAt, now)}{stale ? ' · replay paused or stale' : ''}
    </Typography>
  );
}

export function Disclaimer() {
  return <Typography variant="caption" color="text.secondary">{DISCLAIMER}</Typography>;
}

export function Overline({ children }) {
  return <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>{children}</Typography>;
}

/** 28-reading strip (7 days). Height encodes level too, so it does not rely on colour alone. */
export function LevelStrip({ history, hideSummary = false }) {
  const t = useTheme().hy;
  const counts = [0, 1, 2].map((l) => history.filter((h) => h.level === l).length);
  const summary = `Last ${history.length} readings: ${counts[0]} Normal, ${counts[1]} Watch, ${counts[2]} Critical`;
  return (
    <Box>
      <Box role="img" aria-label={summary} sx={{ display: 'flex', alignItems: 'flex-end', gap: history.length > 60 ? 0 : '2px', height: 22 }}>
        {history.map((h, i) => (
          <Box key={i} sx={{ flex: 1, borderRadius: '2px', height: [7, 14, 22][h.level], bgcolor: t[KEY[h.level]], opacity: h.level ? 1 : 0.45 }} />
        ))}
      </Box>
      {!hideSummary && <Typography variant="caption" color="text.secondary">{summary}</Typography>}
    </Box>
  );
}
