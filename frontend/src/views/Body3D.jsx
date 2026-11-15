import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Vector3 } from 'three';
import { Box } from '@mui/material';
import { KEY, LevelIcon, UI } from '../components/status.jsx';

/*
 * 3D body preview, built only from primitives (no model files, no fonts, no environment maps), so it
 * works offline. Loaded lazily by BodyPreview. Labels are HTML overlays placed from projected anchor
 * points every frame (word + shape + colour). The canvas is aria-hidden: the list next to it is the
 * keyboard and screen-reader path.
 */

const SHORT = { brain: 'Brain', heart: 'Heart', blood: 'Blood', muscles: 'Muscles', radiation: 'Radiation', bones: 'Bones' };
// Where each label points to, in figure coordinates, and which side column it sits in.
const ANCHOR = {
  brain: { p: [0, 1.6, 0.28], side: 'left' },
  heart: { p: [0.12, 0.8, 0.4], side: 'left' },
  muscles: { p: [-0.68, 0.1, 0.1], side: 'left' },
  radiation: { p: [1.08, 0.55, 0], side: 'right' },
  blood: { p: [0, 0.12, 0.34], side: 'right' },
  bones: { p: [0.2, -1.3, 0.1], side: 'right' },
};
const LABEL_H = 34; // min vertical gap between labels in one column (px)

function Part({ k, sel, onPick, color, children, ...rest }) {
  const on = sel === k;
  return (
    <mesh {...rest}
      onClick={(e) => { if (e.delta > 6) return; e.stopPropagation(); onPick(k); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}>
      {children}
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} emissive={color} emissiveIntensity={on ? 0.45 : 0.08} />
    </mesh>
  );
}

function Figure({ colors, neutral, sel, onPick, rot, reduced, labels, lines }) {
  const group = useRef();
  const ring = useRef();
  const { camera, size } = useThree();
  const v = useMemo(() => new Vector3(), []);

  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.rotation.y = rot.current;
    if (ring.current && !reduced) ring.current.rotation.z += dt * 0.4;
    group.current.updateMatrixWorld();
    // Project anchors, then stack each side column so labels never overlap.
    const cols = { left: [], right: [] };
    for (const [k, a] of Object.entries(ANCHOR)) {
      v.set(...a.p).applyMatrix4(group.current.matrixWorld).project(camera);
      cols[a.side].push({ k, x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height });
    }
    for (const [side, list] of Object.entries(cols)) {
      list.sort((p, q) => p.y - q.y);
      let prev = -Infinity;
      for (const p of list) {
        const y = Math.min(Math.max(p.y, prev + LABEL_H, LABEL_H / 2), size.height - LABEL_H / 2);
        prev = y;
        const el = labels.current[p.k];
        if (el) el.style.transform = `translateY(${y - LABEL_H / 2}px)`;
        const ln = lines.current[p.k];
        if (ln && el) {
          const lx = side === 'left' ? el.offsetLeft + el.offsetWidth : el.offsetLeft;
          ln.setAttribute('x1', lx); ln.setAttribute('y1', y); ln.setAttribute('x2', p.x); ln.setAttribute('y2', p.y);
        }
      }
    }
  });

  const part = (k, extra) => ({ k, sel, onPick, color: colors[k], ...extra });
  return (
    <group ref={group} position={[0, 0.02, 0]}>
      {/* head = Brain */}
      <Part {...part('brain')} position={[0, 1.52, 0]}><sphereGeometry args={[0.3, 32, 24]} /></Part>
      <mesh position={[0, 1.15, 0]}><cylinderGeometry args={[0.1, 0.12, 0.2, 16]} /><meshStandardMaterial color={neutral} roughness={0.7} /></mesh>
      {/* chest = Heart & Blood Vessels */}
      <Part {...part('heart')} position={[0, 0.72, 0]}><capsuleGeometry args={[0.4, 0.3, 8, 24]} /></Part>
      {/* abdomen = Blood */}
      <Part {...part('blood')} position={[0, 0.1, 0]}><capsuleGeometry args={[0.33, 0.25, 8, 24]} /></Part>
      {/* spine = Bones (seen from the back) */}
      <Part {...part('bones')} position={[0, 0.5, -0.36]}><capsuleGeometry args={[0.05, 1.2, 4, 12]} /></Part>
      {/* arms and thighs = Muscles */}
      {[-1, 1].map((s) => (
        <React.Fragment key={s}>
          <Part {...part('muscles')} position={[s * 0.62, 0.42, 0]} rotation={[0, 0, s * 0.12]}><capsuleGeometry args={[0.11, 0.85, 6, 16]} /></Part>
          <Part {...part('muscles')} position={[s * 0.19, -0.55, 0]}><capsuleGeometry args={[0.15, 0.45, 6, 16]} /></Part>
          {/* knees and shins = Bones */}
          <Part {...part('bones')} position={[s * 0.19, -0.92, 0]}><sphereGeometry args={[0.12, 16, 12]} /></Part>
          <Part {...part('bones')} position={[s * 0.19, -1.32, 0]}><capsuleGeometry args={[0.08, 0.55, 4, 12]} /></Part>
          <mesh position={[s * 0.19, -1.72, 0.08]}><boxGeometry args={[0.16, 0.08, 0.3]} /><meshStandardMaterial color={neutral} roughness={0.7} /></mesh>
        </React.Fragment>
      ))}
      {/* Radiation marker: an orbit around the body */}
      <group position={[0, 0.55, 0]} rotation={[Math.PI / 2 - 0.3, 0, 0]}>
        <Part {...part('radiation')}><torusGeometry args={[1.08, sel === 'radiation' ? 0.045 : 0.03, 8, 96]} /></Part>
        {/* wider invisible hit area so the thin ring is easy to click or tap */}
        <mesh onClick={(e) => { if (e.delta > 6) return; e.stopPropagation(); onPick('radiation'); }}>
          <torusGeometry args={[1.08, 0.08, 6, 64]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        <group ref={ring}>
          {[0, 1, 2].map((i) => (
            <Part key={i} {...part('radiation')} position={[Math.cos((i * 2 * Math.PI) / 3) * 1.08, Math.sin((i * 2 * Math.PI) / 3) * 1.08, 0]}>
              <sphereGeometry args={[0.06, 12, 8]} />
            </Part>
          ))}
        </group>
      </group>
    </group>
  );
}

export default function Body3D({ systems, sel, onPick, hy, reduced }) {
  const rot = useRef(-0.35);
  const drag = useRef(null);
  const labels = useRef({});
  const lines = useRef({});
  // Normal is muted toward the body colour so Watch and Critical regions stand out; the overlays carry the word and shape.
  const colors = Object.fromEntries(systems.map((s) => [s.key, s.level === 0
    ? `#${new Color(hy.muted).lerp(new Color(hy.normal), 0.5).getHexString()}` : hy[KEY[s.level]]]));
  const byKey = Object.fromEntries(systems.map((s) => [s.key, s]));

  const down = (e) => { drag.current = { x: e.clientX, r: rot.current }; };
  const move = (e) => { if (drag.current) rot.current = drag.current.r + (e.clientX - drag.current.x) * 0.012; };
  const up = () => { drag.current = null; };

  return (
    <Box sx={{ position: 'relative', width: '100%', height: { xs: 400, md: 460 }, touchAction: 'pan-y', userSelect: 'none', cursor: 'grab' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} data-testid="body-3d">
      <Box sx={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 6.4], fov: 36 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
          frameloop="always">
          <ambientLight intensity={0.7} />
          <directionalLight position={[2, 4, 5]} intensity={1.6} />
          <directionalLight position={[-3, 2, -4]} intensity={0.5} />
          <Figure colors={colors} neutral={hy.muted} sel={sel} onPick={onPick} rot={rot} reduced={reduced} labels={labels} lines={lines} />
        </Canvas>
      </Box>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden="true">
        {systems.map((s) => (
          <line key={s.key} ref={(el) => { lines.current[s.key] = el; }} stroke={hy[KEY[s.level]]} strokeWidth={sel === s.key ? 2 : 1} strokeDasharray="3 3" opacity={0.85} />
        ))}
      </svg>
      {Object.entries(ANCHOR).map(([k, a]) => {
        const s = byKey[k];
        if (!s) return null;
        const c = hy[KEY[s.level]];
        const on = sel === k;
        return (
          <Box key={k} ref={(el) => { labels.current[k] = el; }} aria-hidden="true" data-region={k}
            onClick={() => onPick(k)} onPointerDown={(e) => e.stopPropagation()}
            sx={{ position: 'absolute', top: 0, [a.side]: 4, display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, height: LABEL_H - 4,
              borderRadius: 1.5, bgcolor: hy.surface, border: `${on ? 2 : 1}px solid ${c}`, color: c, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              lineHeight: 1.1, whiteSpace: 'nowrap', boxShadow: on ? 3 : 0 }}>
            <LevelIcon level={s.level} size={14} />
            <Box component="span">
              <Box component="span" sx={{ color: hy.text }}>{SHORT[k]}</Box> {UI[s.level]}
              {s.proxy && <Box component="span" sx={{ display: 'block', fontSize: 10, fontWeight: 500, color: hy.text2 }}>follows Gravity</Box>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
