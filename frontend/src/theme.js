import { createTheme } from '@mui/material/styles';

// Brand tokens from brand_designing/ (Space Blue #0985FF, Deep Slate #020617, True Black, Paper)
// and the design-system sheet in the view PDFs (light palette, status colours, type scale).
// Brand rule: never use brand blue as an alarm state; status always = word + shape + colour.
export const THEMES = {
  deepSlate: {
    label: 'Deep Slate', hint: 'Default', mode: 'dark', lockup: '/assets/lockup-deep-slate.svg',
    bg: '#020617', surface: '#0B1324', surface2: '#101B31', border: '#1F2B45',
    text: '#F8FAFC', text2: '#B4BFD1', muted: '#8492AB',
    primary: '#0985FF', onPrimary: '#020617',
    normal: '#4ADE80', watch: '#FB923C', critical: '#F87171',
    normalBg: 'rgba(74,222,128,0.12)', watchBg: 'rgba(251,146,60,0.14)', criticalBg: 'rgba(248,113,113,0.14)',
  },
  trueBlack: {
    label: 'True Black', hint: 'Night', mode: 'dark', lockup: '/assets/lockup-true-black.svg',
    bg: '#000000', surface: '#0A0A0A', surface2: '#141414', border: '#262626',
    text: '#F5F5F5', text2: '#A3A3A3', muted: '#8A8A8A',
    primary: '#0985FF', onPrimary: '#000000',
    normal: '#4ADE80', watch: '#FB923C', critical: '#F87171',
    normalBg: 'rgba(74,222,128,0.10)', watchBg: 'rgba(251,146,60,0.12)', criticalBg: 'rgba(248,113,113,0.12)',
  },
  paper: {
    label: 'Paper', hint: 'Printable', mode: 'light', lockup: '/assets/lockup-paper.svg',
    bg: '#F8FAFD', surface: '#FFFFFF', surface2: '#F1F5F9', border: '#E2E8F0',
    text: '#020617', text2: '#475569', muted: '#64748B',
    primary: '#1B2B85', onPrimary: '#FFFFFF',
    normal: '#15803D', watch: '#C2410C', critical: '#B91C1C',
    normalBg: '#ECFDF3', watchBg: '#FFF4EC', criticalBg: '#FEF2F2',
  },
};

const HEAD = '"Manrope", "Inter", system-ui, sans-serif';
const BODY = '"Inter", system-ui, sans-serif';

export function buildTheme(key) {
  const t = THEMES[key] || THEMES.deepSlate;
  return createTheme({
    hy: t,
    palette: {
      mode: t.mode,
      primary: { main: t.primary, contrastText: t.onPrimary },
      error: { main: t.critical },
      warning: { main: t.watch },
      success: { main: t.normal },
      background: { default: t.bg, paper: t.surface },
      text: { primary: t.text, secondary: t.text2, disabled: t.muted },
      divider: t.border,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: BODY,
      h1: { fontFamily: HEAD, fontWeight: 700, fontSize: 32, lineHeight: 1.2 },
      h2: { fontFamily: HEAD, fontWeight: 700, fontSize: 28, lineHeight: 1.2 },
      h3: { fontFamily: HEAD, fontWeight: 700, fontSize: 24, lineHeight: 1.25 },
      h4: { fontFamily: HEAD, fontWeight: 600, fontSize: 18, lineHeight: 1.3 },
      h5: { fontFamily: HEAD, fontWeight: 600, fontSize: 16 },
      h6: { fontFamily: HEAD, fontWeight: 600, fontSize: 14 },
      subtitle2: { fontFamily: HEAD, fontWeight: 600 },
      button: { fontFamily: HEAD, fontWeight: 600, textTransform: 'none' },
      overline: { fontSize: 12, letterSpacing: '0.08em', fontWeight: 500 },
      body1: { fontSize: 16 }, body2: { fontSize: 14 }, caption: { fontSize: 12.5 },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { backgroundColor: t.bg }, '@media print': { '.no-print': { display: 'none !important' } } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { border: `1px solid ${t.border}`, backgroundColor: t.surface, borderRadius: 12 } },
      },
      MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 8, minHeight: 40 } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: t.border }, head: { color: t.text2, fontWeight: 600, fontSize: 12.5 } } },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: 12.5 } } },
    },
  });
}
