// Floor plan for the demo house. Edit to match your real room setup.
// x/y are 0-100 (percent of the dashboard map). bearing = degrees clockwise from
// the wearer's "forward" when they stand in the living room facing the TV.
export const ZONES = {
  kitchen: { label: 'Kitchen', x: 20, y: 25, bearing: 300 },
  living: { label: 'Living room', x: 55, y: 55, bearing: 0 },
  bedroom: { label: 'Bedroom', x: 82, y: 25, bearing: 60 },
  hallway: { label: 'Hallway', x: 50, y: 85, bearing: 180 },
}

export const ALERT_TEXT = {
  smoke_alarm: { icon: '🔥', text: 'Smoke alarm' },
  doorbell: { icon: '🔔', text: 'Doorbell' },
  name_called: { icon: '🗣️', text: 'Someone called your name' },
  fall: { icon: '⚠️', text: 'Possible fall' },
  glass_break: { icon: '💥', text: 'Glass breaking' },
  baby_cry: { icon: '👶', text: 'Baby crying' },
}

export const SEVERITY_COLOR = { critical: '#ef4444', warning: '#f59e0b', info: '#38bdf8' }
