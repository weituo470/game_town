// Eager, lightweight ground-world contract. Orbital geometry loads separately.
export const SPACE_ELEVATOR = Object.freeze({
  port: Object.freeze({x:1100,y:0,z:-1040}), portRadius:34,
  cityCenter: Object.freeze([18000,100000,-27000]),
  envelopeRadius:600,
  dock: Object.freeze({x:72,y:0,z:75,yaw:Math.PI/2}),
  durationMs:140000, far:180000, mode:'continuous-world',
});
export function inSpacePort(x,z){return Number.isFinite(x)&&Number.isFinite(z)&&Math.hypot(x-SPACE_ELEVATOR.port.x,z-SPACE_ELEVATOR.port.z)<=SPACE_ELEVATOR.portRadius;}

export function inRailStation(x,z){return x>=24&&x<=48&&z>=39&&z<=71;}
