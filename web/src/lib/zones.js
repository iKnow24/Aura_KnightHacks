// Floor plan for the demo house. Edit to match your real room setup.
// x/y are 0-100 (percent of the dashboard map). bearing = degrees clockwise from
// the wearer's "forward" when they stand in the living room facing the TV.
export const ZONES = {
  // Demo setup: ONE room phone (the Mac webcam on /node?zone=living). The other rooms stay as labels so old
  // alerts and seeded memory still read well, but map: false keeps them off the floor plan and the QR codes.
  living: { label: 'Living room', x: 50, y: 50, bearing: 0 },
  kitchen: { label: 'Kitchen', bearing: 300, map: false },
  bedroom: { label: 'Bedroom', bearing: 60, map: false },
  hallway: { label: 'Hallway', bearing: 180, map: false },
  // Not rooms: places relative to the wearer (Outside mode). map: false keeps them off the floor plan.
  behind: { label: 'Behind you', bearing: 180, map: false },
  wearer: { label: 'Near you', bearing: 0, map: false },
  // The four pitch mics, one compass point each. map: false keeps them off the floor plan.
  Mic: { label: '1 Mic', bearing: 90, map: false },
  drone: { label: 'Security camera', bearing: 270, map: false },
}

export const zoneLabel = (zone) => ZONES[zone]?.label ?? zone

export const ALERT_TEXT = {
  smoke_alarm: { icon: '🔥', text: 'Smoke alarm' },
  doorbell: { icon: '🔔', text: 'Doorbell' },
  name_called: { icon: '🗣️', text: 'Someone called your name' },
  fall: { icon: '⚠️', text: 'Possible fall' },
  glass_break: { icon: '💥', text: 'Glass breaking' },
  baby_cry: { icon: '👶', text: 'Baby crying' },
  // Everyday sounds people miss
  timer: { icon: '⏲️', text: 'Timer going off' },
  kettle: { icon: '🫖', text: 'Kettle boiling' },
  phone_ring: { icon: '📱', text: 'Phone ringing' },
  knock: { icon: '🚪', text: 'Knock at the door' },
  alarm_clock: { icon: '⏰', text: 'Alarm clock' },
  water_running: { icon: '🚰', text: 'Water still running' },
  dog_bark: { icon: '🐕', text: 'Dog barking' },
  car_alarm: { icon: '🚨', text: 'Car alarm' },
  // Outside
  car_horn: { icon: '📯', text: 'Car horn' },
  siren: { icon: '🚑', text: 'Siren nearby' },
  vehicle: { icon: '🚗', text: 'Car approaching' },
  bike_bell: { icon: '🚲', text: 'Bike bell' },
  reversing: { icon: '🚛', text: 'Vehicle reversing' },
  person_behind: { icon: '🚶', text: 'Someone walking up behind you' },
  vehicle_behind: { icon: '🚗', text: 'Vehicle coming up behind you' },
  spill: { icon: '💧', text: 'Something spilled' },
  bike_behind: { icon: '🚲', text: 'Bike coming up behind you' },
}

export const alertText = (kind) => ALERT_TEXT[kind] ?? { icon: '❗', text: kind }

export const SEVERITY_COLOR = { critical: '#ef4444', warning: '#f59e0b', info: '#38bdf8' }

// One color per person in the headset view (speech bubbles and the dashboard conversation).
export const SPEAKER_COLORS = ['#fbbf24', '#38bdf8', '#f472b6']
