// Equipment and engine exhaust are presentation only. `jetpack` still means
// active flight in authoritative physics; it must never be enabled on spawn
// merely to show a backpack, nor may hover flames turn `thrusting` back on.
export function jetpackVisualState(pose) {
  const equipped = !pose?.activity;
  const airborne = Number.isFinite(pose?.y) && pose.y > 0.015;
  const powered = equipped && airborne && pose?.jetpack === true;
  return {
    equipped,
    firing: powered && (pose.thrusting === true || pose.hovering === true),
    hovering: powered && pose.hovering === true && pose.thrusting !== true,
  };
}
