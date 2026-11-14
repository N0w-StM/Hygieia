import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, store } from './api.js';

const LiveContext = createContext(null);
export const useLive = () => useContext(LiveContext);

/** Re-render once a second (data-age labels). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Subscribe to one live event type ("message", "alert", ...). */
export function useLiveEvent(type, handler) {
  const { subscribe } = useLive();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(type, (d) => ref.current(d)), [subscribe, type]);
}

export function LiveProvider({ role, astronautId, children }) {
  const [crew, setCrew] = useState([]);
  const [doctor, setDoctor] = useState({ name: 'Crew medical officer', role: '' });
  const [records, setRecords] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [replay, setReplay] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [storage, setStorage] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const listeners = useRef(new Map());

  const subscribe = useCallback((type, fn) => {
    if (!listeners.current.has(type)) listeners.current.set(type, new Set());
    listeners.current.get(type).add(fn);
    return () => listeners.current.get(type)?.delete(fn);
  }, []);
  const emit = (type, data) => listeners.current.get(type)?.forEach((fn) => fn(data));

  const upsertAlert = (a) => setAlerts((list) => {
    const rest = list.filter((x) => x.alert_id !== a.alert_id);
    return [a, ...rest].sort((x, y) => (x.triggered_at < y.triggered_at ? 1 : -1));
  });

  const load = useCallback(async () => {
    const audience = role;
    const [c, al, rp] = await Promise.all([
      api.get('/crew', { view: role }),
      api.get('/alerts', { audience, astronaut_id: role === 'astronaut' ? astronautId : null, limit: 200 }),
      api.get('/replay'),
    ]);
    setCrew(c.crew.map(({ latest, ...rest }) => rest));
    setDoctor(c.doctor);
    setRecords(Object.fromEntries(c.crew.filter((x) => x.latest).map((x) => [x.astronaut_id, x.latest])));
    setStorage(c.storage);
    setAlerts(role === 'astronaut' ? al.alerts.filter((a) => a.audience.includes('astronaut') || a.source === 'astronaut') : al.alerts);
    setReplay(rp.replay);
    setScenarios(rp.scenarios);
    setLoaded(true);
  }, [role, astronautId]);

  useEffect(() => {
    let closed = false;
    setLoaded(false);
    load().catch(() => setConnected(false));
    const qs = new URLSearchParams(role === 'astronaut' ? { view: 'astronaut', astronaut_id: astronautId } : { view: 'doctor' });
    const es = new EventSource(`/api/stream?${qs}`);
    const on = (type, fn) => es.addEventListener(type, (e) => { if (!closed) fn(JSON.parse(e.data)); });
    on('hello', (d) => {
      setConnected(true); setReplay(d.replay); setStorage(d.storage);
      load().catch(() => {}); // resync after a reconnect
    });
    on('tick', (d) => {
      setReplay(d.replay);
      setRecords((prev) => ({ ...prev, ...Object.fromEntries(d.records.map((r) => [r.astronaut_id, r])) }));
      emit('tick', d);
    });
    on('replay', (d) => setReplay(d));
    on('storage', (d) => setStorage(d));
    on('alert', (a) => { upsertAlert(a); setToast({ id: a.alert_id, alert: a }); emit('alert', a); });
    on('alert_cleared', (a) => { upsertAlert(a); emit('alert_cleared', a); });
    on('alert_ack', (a) => { upsertAlert(a); emit('alert_ack', a); });
    on('message', (m) => emit('message', m));
    on('checkin', (c) => emit('checkin', c));
    es.onerror = () => { if (!closed) setConnected(false); };
    return () => { closed = true; es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, astronautId]);

  const control = useCallback(async (action, body) => {
    const r = await api.post(`/replay/${action}`, body);
    setReplay(r.replay);
    return r.replay;
  }, []);

  const value = useMemo(() => ({
    role, astronautId, crew, doctor, records, alerts, replay, scenarios, storage, connected, loaded,
    toast, clearToast: () => setToast(null), subscribe, control, upsertAlert,
    nameOf: (id) => crew.find((c) => c.astronaut_id === id)?.name || id,
  }), [role, astronautId, crew, doctor, records, alerts, replay, scenarios, storage, connected, loaded, toast, subscribe, control]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const prefs = {
  get: (k, d) => store.get(k, d),
  set: (k, v) => store.set(k, v),
};
