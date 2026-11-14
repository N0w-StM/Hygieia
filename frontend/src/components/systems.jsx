import React from 'react';
import PsychologyOutlined from '@mui/icons-material/PsychologyOutlined';
import FavoriteBorderOutlined from '@mui/icons-material/FavoriteBorderOutlined';
import WaterDropOutlined from '@mui/icons-material/WaterDropOutlined';
import FitnessCenterOutlined from '@mui/icons-material/FitnessCenterOutlined';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Svg = ({ children }) => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{children}</svg>;

const RadiationIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="1.8" {...stroke} />
    <path {...stroke} d="M12 3.2a8.8 8.8 0 0 1 4.4 1.2L13.7 9a3.4 3.4 0 0 0-3.4 0L7.6 4.4A8.8 8.8 0 0 1 12 3.2zM20.8 12a8.8 8.8 0 0 1-4.4 7.6L13.7 15a3.4 3.4 0 0 0 1.7-3zM3.2 12h5.4a3.4 3.4 0 0 0 1.7 3l-2.7 4.6A8.8 8.8 0 0 1 3.2 12z" />
  </Svg>
);
const BoneIcon = () => (
  <Svg>
    <path {...stroke} d="M7.6 4.2a2.4 2.4 0 0 1 2.3 3.1l6.8 6.8a2.4 2.4 0 1 1 1.4 4.3 2.4 2.4 0 1 1-4.3 1.4l-6.8-6.8a2.4 2.4 0 1 1-1.4-4.3 2.4 2.4 0 0 1 2-4.5z" transform="rotate(0 12 12) scale(.92) translate(1 1)" />
  </Svg>
);

export function SystemIcon({ k }) {
  switch (k) {
    case 'brain': return <PsychologyOutlined />;
    case 'heart': return <FavoriteBorderOutlined />;
    case 'blood': return <WaterDropOutlined />;
    case 'muscles': return <FitnessCenterOutlined />;
    case 'radiation': return <RadiationIcon />;
    case 'bones': return <BoneIcon />;
    default: return null;
  }
}

/** Plain-language line for a system tile, Astronaut View. */
export function systemLine(s) {
  if (s.level === 0) return 'Within your usual range.';
  if (s.level === 1) return 'Flagged for review. Follow your next action.';
  return 'Flagged for review now. Contact your flight surgeon.';
}
