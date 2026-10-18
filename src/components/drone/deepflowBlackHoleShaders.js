/**
 * Original Game Town open-source placeholder, authored for this project.
 * A stylized dark core and luminous rings, not a gravitational simulation.
 * No website shader, external asset, ray tracer or copied lensing code is used.
 * The filename is retained only so existing imports need not move.
 */
export const BLACK_HOLE_SHADER_PROVENANCE = 'original-open-source-placeholder-v1';

const vertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;
const fragment = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uAspect;
  void main() {
    vec2 p = (vUv - vec2(0.5)) * vec2(uAspect, 1.0);
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float core = 1.0 - smoothstep(0.100, 0.115, radius);
    float ringDistance = (radius - 0.121) / 0.010;
    float ring = exp(-ringDistance * ringDistance);
    float ellipse = length(vec2(p.x, p.y * 4.0));
    float discDistance = (ellipse - 0.225) / 0.045;
    float disc = exp(-discDistance * discDistance);
    float flow = 0.86 + 0.14 * sin(angle * 3.0 - uTime * 0.15);
    float halo = exp(-max(0.0, radius - 0.12) * 19.0) * 0.16;
    vec3 light = vec3(1.0, 0.52, 0.16) * disc * flow
      + vec3(0.48, 0.72, 1.0) * ring + vec3(0.2, 0.28, 0.4) * halo;
    light *= 1.0 - core;
    float alpha = clamp(max(core, max(disc, ring) + halo), 0.0, 1.0) * uOpacity;
    if (alpha < 0.001) discard;
    gl_FragColor = vec4(light, alpha);
    #include <colorspace_fragment>
  }
`;

export const BLACK_HOLE_SHADERS = Object.freeze({ vertex, skyVertex, fragment });
// Compatibility name only; these blocks are not derived from DeepFlow source.
export const DEEPFLOW_SHADERS = BLACK_HOLE_SHADERS;
