// 8 named Gaborone waypoints, all inside lat -24.60..-24.70, lng 25.85..25.95.
// Idle couriers wander between these; they are also handy anchor points for
// seeding merchant pickup locations and demo courier start positions.
export const WAYPOINTS: { name: string; lat: number; lng: number }[] = [
  { name: 'CBD', lat: -24.6282, lng: 25.9231 },
  { name: 'Main Mall', lat: -24.6539, lng: 25.9089 },
  { name: 'Broadhurst', lat: -24.6392, lng: 25.9412 },
  { name: 'Game City', lat: -24.6685, lng: 25.9107 },
  { name: 'Riverwalk', lat: -24.6743, lng: 25.9298 },
  { name: 'Extension 9', lat: -24.6198, lng: 25.8912 },
  { name: 'University of Botswana', lat: -24.6841, lng: 25.9214 },
  { name: 'Airport Junction', lat: -24.6061, lng: 25.9183 },
];

export function randomPointInGaborone(): { lat: number; lng: number } {
  const lat = -24.7 + Math.random() * (24.7 - 24.6);
  const lng = 25.85 + Math.random() * (25.95 - 25.85);
  return { lat, lng };
}
