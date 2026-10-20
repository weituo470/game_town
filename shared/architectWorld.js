import { ARCHITECT_BUILDING_BOUNDS, architectPlot, validateArchitectPlan } from './architectPlan.js';

/** One-way runtime projection. Polling an older/empty response never erases a
 * building; a known ID or occupied site can never be changed by a later packet. */
export function createArchitectWorld() {
  const projects = new Map(), sites = new Set();
  function append(values) {
    if (!Array.isArray(values)) return 0;
    let added = 0;
    for (const value of values.slice(0, 24)) {
      if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(value.id) || projects.has(value.id)) continue;
      try {
        const plan = validateArchitectPlan(value.plan);
        if (sites.has(plan.plotId) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 ||
            !['autonomous', 'approved'].includes(value.source) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) continue;
        projects.set(value.id, Object.freeze({ id: value.id, createdAt: value.createdAt, day: value.day, source: value.source, plan }));
        sites.add(plan.plotId); added++;
      } catch { /* Untrusted packets fail closed without changing known geometry. */ }
    }
    return added;
  }
  function solid(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const { halfWidth, halfDepth } = ARCHITECT_BUILDING_BOUNDS;
    for (const project of projects.values()) {
      const site = architectPlot(project.plan.plotId);
      if (Math.abs(x - site.x) < halfWidth + 0.25 && Math.abs(z - site.z) < halfDepth + 0.25) return true;
    }
    return false;
  }
  return { append, solid, projects: () => [...projects.values()] };
}
const world = createArchitectWorld();
export const appendArchitectProjects = values => world.append(values);
export const isArchitectSolid = (x, z) => world.solid(x, z);
export const getArchitectProjects = () => world.projects();
