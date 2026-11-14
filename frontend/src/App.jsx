import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, BottomNavigation, BottomNavigationAction, Box, Button, CssBaseline, Divider, IconButton, MenuItem,
  Popover, Select, Snackbar, Stack, ThemeProvider, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import AccessibilityNewOutlined from '@mui/icons-material/AccessibilityNewOutlined';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import PersonSearchOutlined from '@mui/icons-material/PersonSearchOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import PortableWifiOffOutlined from '@mui/icons-material/PortableWifiOffOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import { THEMES, buildTheme } from './theme.js';
import { LiveProvider, prefs, useLive, useNow } from './live.jsx';
import { ago } from './api.js';
import { Disclaimer, StatusBadge, needsAck } from './components/status.jsx';
import ScenarioBar from './components/ScenarioBar.jsx';
import MyStatus from './views/MyStatus.jsx';
import Hazards from './views/Hazards.jsx';
import BodyPreview from './views/BodyPreview.jsx';
import Contact from './views/Contact.jsx';
import AiChat from './views/AiChat.jsx';
import CrewOverview from './views/CrewOverview.jsx';
import CrewDetail from './views/CrewDetail.jsx';
import AlertCentre, { AlertRow } from './views/AlertCentre.jsx';

const NAV = {
  astronaut: [
    { id: 'status', label: 'My Status', short: 'Status', icon: <MonitorHeartOutlined /> },
    { id: 'hazards', label: '5 Hazards', short: 'Hazards', icon: <HubOutlined /> },
    { id: 'body', label: 'Body Preview', short: 'Body', icon: <AccessibilityNewOutlined /> },
    { id: 'contact', label: 'Doctor', icon: <ForumOutlined /> },
    { id: 'chat', label: 'AI Chat', short: 'Chat', icon: <SmartToyOutlined /> },
  ],
  doctor: [
    { id: 'overview', label: 'Crew Overview', short: 'Crew', icon: <GridViewOutlined /> },
    { id: 'detail', label: 'Crew Member', short: 'Member', icon: <PersonSearchOutlined /> },
    { id: 'hazards', label: '5 Hazards', short: 'Hazards', icon: <HubOutlined /> },
    { id: 'alerts', label: 'Alerts', icon: <NotificationsNoneOutlined /> },
    { id: 'contact', label: 'Astronauts', short: 'Contact', icon: <ForumOutlined /> },
  ],
};

function readHash() {
  const [, role, tab] = window.location.hash.split('/');
  if (!NAV[role]) return null;
  return { role, tab: NAV[role].some((n) => n.id === tab) ? tab : NAV[role][0].id };
}

export default function App() {
  const initial = readHash() || { role: prefs.get('role', 'astronaut'), tab: null };
  const [role, setRole] = useState(NAV[initial.role] ? initial.role : 'astronaut');
  const [tab, setTab] = useState(initial.tab || NAV[role][0].id);
  const [astronautId, setAstronautId] = useState(prefs.get('astronautId', 'ASTRO_001'));
  const [selectedId, setSelectedId] = useState(prefs.get('selectedId', 'ASTRO_001'));
  const [themeKey, setThemeKey] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('theme'); // e.g. ?theme=paper for a printable view
    return THEMES[q] ? q : prefs.get('theme', 'deepSlate');
  });
  const theme = useMemo(() => buildTheme(themeKey), [themeKey]);

  useEffect(() => { window.location.hash = `/${role}/${tab}`; prefs.set('role', role); window.scrollTo(0, 0); }, [role, tab]);
  useEffect(() => {
    const onHash = () => { const h = readHash(); if (h) { setRole(h.role); setTab(h.tab); } };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => prefs.set('astronautId', astronautId), [astronautId]);
  useEffect(() => prefs.set('selectedId', selectedId), [selectedId]);
  useEffect(() => prefs.set('theme', themeKey), [themeKey]);

  const switchRole = (r) => { if (r && r !== role) { setRole(r); setTab(NAV[r][0].id); } };
  const subjectId = role === 'astronaut' ? astronautId : selectedId;
  const setSubjectId = role === 'astronaut' ? setAstronautId : setSelectedId;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <LiveProvider role={role} astronautId={astronautId}>
        <Shell {...{ role, switchRole, tab, setTab, subjectId, setSubjectId, themeKey, setThemeKey }} />
      </LiveProvider>
    </ThemeProvider>
  );
}

function Shell({ role, switchRole, tab, setTab, subjectId, setSubjectId, themeKey, setThemeKey }) {
  const live = useLive();
  const wide = useMediaQuery((t) => t.breakpoints.up('md'));
  const hy = THEMES[themeKey];
  const nav = NAV[role];
  const title = nav.find((n) => n.id === tab)?.label;
  const record = live.records[subjectId];
  const go = (t, id) => { if (id) setSubjectId(id); setTab(t); };

  let page = null;
  if (!live.loaded && !live.connected) page = <Connecting />;
  else if (role === 'astronaut') {
    page = {
      status: <MyStatus id={subjectId} go={go} />,
      hazards: <Hazards id={subjectId} view="astronaut" />,
      body: <BodyPreview id={subjectId} go={go} />,
      contact: <Contact id={subjectId} me="astronaut" />,
      chat: <AiChat id={subjectId} go={go} />,
    }[tab];
  } else {
    page = {
      overview: <CrewOverview go={go} />,
      detail: <CrewDetail id={subjectId} go={go} />,
      hazards: <Hazards id={subjectId} view="doctor" />,
      alerts: <AlertCentre go={go} />,
      contact: <Contact id={subjectId} me="doctor" />,
    }[tab];
  }
  const showPicker = role === 'astronaut' || ['detail', 'hazards', 'contact'].includes(tab);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
      {wide && (
        <Box component="nav" aria-label="Main" className="no-print"
          sx={{ width: 248, flex: 'none', borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', p: 2, gap: 0.5, bgcolor: hy.navBg,
            position: 'sticky', top: 0, height: '100vh' }}>
          <Box component="img" src={hy.lockup} alt="Hygieia Health Monitoring" sx={{ width: 190, mb: 1, ml: -1 }} />
          <Typography variant="overline" color="text.secondary" sx={{ px: 1 }}>{role === 'astronaut' ? 'Astronaut' : 'Crew medical officer'}</Typography>
          {nav.map((n) => (
            <Button key={n.id} onClick={() => setTab(n.id)} startIcon={n.icon} aria-current={tab === n.id ? 'page' : undefined}
              variant={tab === n.id ? 'contained' : 'text'} color={tab === n.id ? 'primary' : 'inherit'}
              sx={{ justifyContent: 'flex-start', px: 2, py: 1.25, color: tab === n.id ? undefined : 'text.secondary' }}>
              {n.label}
            </Button>
          ))}
          <Box sx={{ flex: 1 }} />
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2">{role === 'astronaut' ? live.nameOf(subjectId) : live.doctor.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {role === 'astronaut' ? (live.crew.find((c) => c.astronaut_id === subjectId)?.role || 'Crew member') : live.doctor.role}
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box component="header" className="no-print"
          sx={{ px: { xs: 2, md: 4 }, py: { xs: 1, md: 1.5 }, borderBottom: 1, borderColor: 'divider', position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.default' }}>
          {(() => {
            const picker = showPicker && (
              <Select size="small" value={live.crew.length ? subjectId : ''} onChange={(e) => setSubjectId(e.target.value)}
                inputProps={{ 'aria-label': role === 'astronaut' ? 'Signed in as' : 'Crew member' }} sx={{ minWidth: { xs: 0, md: 150 }, maxWidth: { xs: 170, md: 'none' } }}>
                {live.crew.map((c) => <MenuItem key={c.astronaut_id} value={c.astronaut_id}>{c.name}</MenuItem>)}
              </Select>
            );
            const met = (
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                MET {live.replay?.met || '---:--:--'}
              </Typography>
            );
            const roleSwitch = (
              <ToggleButtonGroup size="small" exclusive value={role} onChange={(_, v) => switchRole(v)} aria-label="View">
                <ToggleButton value="astronaut">Astronaut</ToggleButton>
                <ToggleButton value="doctor">Doctor</ToggleButton>
              </ToggleButtonGroup>
            );
            const themeSelect = (
              <Select size="small" value={themeKey} onChange={(e) => setThemeKey(e.target.value)} inputProps={{ 'aria-label': 'Cabin theme' }}>
                {Object.entries(THEMES).map(([k, t]) => <MenuItem key={k} value={k}>{t.label}</MenuItem>)}
              </Select>
            );
            if (wide) {
              return (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Typography variant="h3" component="h1" sx={{ mr: 'auto' }}>{title}</Typography>
                  {picker}{met}<SyncChip /><Bell role={role} subjectId={subjectId} go={go} />{roleSwitch}{themeSelect}
                </Stack>
              );
            }
            return (
              <Stack spacing={0.75}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Box component="img" src="/assets/emblem.svg" alt="Hygieia" sx={{ width: 28, height: 28 }} />
                  <Typography variant="h3" component="h1" noWrap sx={{ mr: 'auto', fontSize: 20, minWidth: 0 }}>{title}</Typography>
                  <Bell role={role} subjectId={subjectId} go={go} />
                  <SettingsMenu>{roleSwitch}{themeSelect}</SettingsMenu>
                </Stack>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}>
                  {picker}{met}<SyncChip />
                </Stack>
              </Stack>
            );
          })()}
        </Box>

        {live.loaded && !live.connected && (
          <Alert severity="warning" icon={<PortableWifiOffOutlined />} sx={{ borderRadius: 0 }}>
            Connection to the Hygieia backend was lost. Showing the last data received. Reconnecting…
          </Alert>
        )}

        <Box component="main" sx={{ flex: 1, px: { xs: 2, md: 4 }, py: 3, pb: { xs: 22, md: 14 }, maxWidth: 1280, width: '100%' }}>
          {page}
          <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Disclaimer />
            <Typography variant="caption" color="text.secondary">NASA SPACE APPS / HYGIEIA{record ? ` · model ${record.model_version || 'v2'}` : ''}</Typography>
          </Box>
        </Box>

        <ScenarioBar setSubjectId={setSubjectId} bottomOffset={wide ? 0 : 56} defaultOpen={wide} />
        {!wide && (
          <BottomNavigation className="no-print" showLabels value={tab} onChange={(_, v) => setTab(v)}
            sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: 'divider', zIndex: 20, bgcolor: 'background.paper' }}>
            {nav.map((n) => <BottomNavigationAction key={n.id} value={n.id} label={n.short || n.label} aria-label={n.label} icon={n.icon} sx={{ minWidth: 0, px: 0.5, '& .MuiBottomNavigationAction-label': { whiteSpace: 'nowrap', fontSize: 12 } }} />)}
          </BottomNavigation>
        )}
      </Box>
      <AlertToast role={role} />
    </Box>
  );
}

function SettingsMenu({ children }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <Tooltip title="View and theme">
        <IconButton aria-label="View and theme" onClick={(e) => setAnchor(e.currentTarget)} color="inherit"><TuneOutlined /></IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Stack spacing={1.5} sx={{ p: 2 }}>
          <Typography variant="overline" color="text.secondary">View</Typography>
          {children[0]}
          <Typography variant="overline" color="text.secondary">Cabin theme</Typography>
          {children[1]}
        </Stack>
      </Popover>
    </>
  );
}

function Connecting() {
  return (
    <Stack spacing={1} sx={{ py: 8, alignItems: 'center', textAlign: 'center' }}>
      <PortableWifiOffOutlined fontSize="large" />
      <Typography variant="h4">Connecting to the Hygieia backend…</Typography>
      <Typography color="text.secondary">Start it with the command in the README, then this page will load by itself.</Typography>
    </Stack>
  );
}

function SyncChip() {
  const { storage, connected } = useLive();
  if (!connected || !storage) {
    return <Chipish icon={<PortableWifiOffOutlined fontSize="small" />} text="No link" tone="watch" tip="The app cannot reach its backend." />;
  }
  if (storage.offline) {
    const tip = storage.reason === 'not_configured'
      ? 'Running on the local data store. No database link is configured.'
      : `Database link is down. Everything is saved on this device${storage.pending_sync ? ` (${storage.pending_sync} items waiting to sync)` : ''}.`;
    return <Chipish icon={<CloudOffOutlined fontSize="small" />} text="Offline mode" tone="watch" tip={tip} />;
  }
  return <Chipish icon={<CloudDoneOutlined fontSize="small" />} text="Synced" tone="normal" tip="Saved locally and mirrored to the mission database." />;
}

function Chipish({ icon, text, tone, tip }) {
  return (
    <Tooltip describeChild title={tip}>
      <Box role="status" sx={(t) => ({ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 1.5, fontSize: 13, fontWeight: 600,
        color: t.hy[tone], bgcolor: t.hy[`${tone}Bg`] })}>
        {icon}{text}
      </Box>
    </Tooltip>
  );
}

function Bell({ role, subjectId, go }) {
  const { alerts } = useLive();
  const now = useNow(5000);
  const [anchor, setAnchor] = useState(null);
  const seenKey = `seen.${subjectId}`;
  const [seenAt, setSeenAt] = useState(prefs.get(seenKey, ''));
  useEffect(() => setSeenAt(prefs.get(seenKey, '')), [seenKey]);

  const mine = role === 'astronaut' ? alerts.filter((a) => a.source !== 'astronaut') : alerts;
  const count = role === 'astronaut'
    ? mine.filter((a) => a.triggered_at > seenAt).length
    : mine.filter(needsAck).length;
  const open = (e) => {
    setAnchor(e.currentTarget);
    if (role === 'astronaut' && mine[0]) { prefs.set(seenKey, mine[0].triggered_at); }
  };
  const close = () => { setAnchor(null); if (role === 'astronaut') setSeenAt(prefs.get(seenKey, '')); };

  return (
    <>
      <Tooltip title={role === 'astronaut' ? 'Notifications' : 'Notifications (unacknowledged)'}>
        <IconButton onClick={open} aria-label={`Notifications, ${count} new`} color="inherit">
          <Badge badgeContent={count} color="error" max={99}><NotificationsNoneOutlined /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Box sx={{ width: { xs: 320, sm: 420 }, maxHeight: 480, overflow: 'auto', p: 2 }}>
          <Typography variant="h4" sx={{ mb: 1 }}>Notifications</Typography>
          {mine.length === 0 && <Typography color="text.secondary" variant="body2">Nothing to review.</Typography>}
          <Stack divider={<Divider />} spacing={1.5}>
            {mine.slice(0, 8).map((a) => <AlertRow key={a.alert_id} alert={a} now={now} compact canAck={role === 'doctor'} />)}
          </Stack>
          {role === 'doctor' && mine.length > 0 && (
            <Button sx={{ mt: 1.5 }} onClick={() => { close(); go('alerts'); }}>Open notification centre</Button>
          )}
        </Box>
      </Popover>
    </>
  );
}

function AlertToast({ role }) {
  const { toast, clearToast, nameOf } = useLive();
  const a = toast?.alert;
  if (!a || (role === 'astronaut' && a.source === 'astronaut')) return null;
  const level = a.level === 'RED' ? 2 : a.level === 'ORANGE' ? 1 : null;
  return (
    <Snackbar open key={toast.id} autoHideDuration={8000} onClose={clearToast} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Box role="alert" sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 2, maxWidth: 480, boxShadow: 6 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
          {level != null ? <StatusBadge level={level} size="small" /> : <Typography variant="subtitle2">Astronaut alert</Typography>}
          <Typography variant="caption" color="text.secondary">
            {role === 'doctor' ? nameOf(a.astronaut_id) : 'About you'} · {a.source === 'astronaut' ? 'sent by astronaut' : a.source === 'rule' ? 'protocol rule' : 'model alert'}
          </Typography>
        </Stack>
        <Typography variant="body2">{a.message}</Typography>
        <Typography variant="caption" color="text.secondary">{ago(a.triggered_at, Date.now())}</Typography>
      </Box>
    </Snackbar>
  );
}
