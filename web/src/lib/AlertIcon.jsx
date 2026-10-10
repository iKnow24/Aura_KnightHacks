import {
  AlarmClock, Ambulance, Baby, BellRing, Bike, Car, CircleAlert, Coffee, Dog, DoorClosed, Droplets, Flame,
  Footprints, Megaphone, PhoneCall, Siren, Speech, Timer, TriangleAlert, Truck, Zap,
} from 'lucide-react'

// Line icons for each alert kind, used where an alert is shown big (toasts, timeline, buttons).
// zones.js keeps its emoji too, for plain-text spots like voice replies and joined lists.
const ICONS = {
  smoke_alarm: Flame, doorbell: BellRing, name_called: Speech, fall: TriangleAlert, glass_break: Zap,
  baby_cry: Baby, timer: Timer, kettle: Coffee, phone_ring: PhoneCall, knock: DoorClosed,
  alarm_clock: AlarmClock, water_running: Droplets, dog_bark: Dog, car_alarm: Siren, car_horn: Megaphone,
  siren: Ambulance, vehicle: Car, bike_bell: Bike, reversing: Truck, person_behind: Footprints,
  vehicle_behind: Car, bike_behind: Bike,
}

// Sized in em so it follows the surrounding text size, like the emoji it replaces.
export default function AlertIcon({ kind, className = '', strokeWidth = 2 }) {
  const Icon = ICONS[kind] ?? CircleAlert
  return <Icon size="1em" strokeWidth={strokeWidth} className={`inline-block shrink-0 ${className}`} aria-hidden="true" />
}
