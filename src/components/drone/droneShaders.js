// The entire luminous fleet is one draw call. A soft aureole and a small,
// white-hot core replace a full-screen bloom pass and remain legible at dusk.
export const DRONE_VERTEX_SHADER = /* glsl */`
  attribute float aSize;
  attribute vec3 color;
  uniform float uViewportHeight;
  uniform float uMaxPointSize;
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float perspective = step(0.5, abs(projectionMatrix[2][3]));
    float attenuation = mix(1.0, 1.0 / max(1.0, -viewPosition.z), perspective);
    float pixels = aSize * uViewportHeight * projectionMatrix[1][1] * 0.5 * attenuation;
    // Four core radii fit in the sprite; the glow never needs extra geometry.
    gl_PointSize = clamp(pixels * 4.2, 1.0, uMaxPointSize);
    vColor = color;
    vVisible = smoothstep(0.001, 0.12, aSize);
  }
`;

export const DRONE_FRAGMENT_SHADER = /* glsl */`
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float radius2 = dot(p, p);
    if (radius2 > 1.0 || vVisible < 0.001) discard;
    float core = exp(-radius2 * 90.0);
    float aureole = exp(-radius2 * 8.0);
    float corona = exp(-radius2 * 26.0);
    float edge = 1.0 - smoothstep(0.60, 1.0, radius2);
    float alpha = (core + corona * 0.62 + aureole * 0.24) * edge * vVisible;
    vec3 light = vColor * (0.90 + corona * 0.25);
    light += vec3(1.0, 0.95, 0.84) * core * min(0.70, max(vColor.r, max(vColor.g, vColor.b)) * 0.35);
    gl_FragColor = vec4(light, alpha);
    #include <colorspace_fragment>
  }
`;

// AI contours use widely separated lamps, not continuous neon tubing. Keep
// their small halo inside one compact sprite; normal alpha blending avoids
// additive energy stacking at contour intersections and during morphs.
export const AI_DRONE_LIGHT_PROFILE = Object.freeze({ spriteScale: 2.4, minPixels: 5.0, maxPixels: 14, coreInner: .26, coreOuter: .50, haloGain: .10, peak: 1.60 });

export const AI_DRONE_VERTEX_SHADER = /* glsl */`
  attribute float aSize;
  attribute vec3 color;
  uniform float uViewportHeight;
  uniform float uMaxPointSize;
  uniform float uMinPointSize;
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float perspective = step(0.5, abs(projectionMatrix[2][3]));
    float attenuation = mix(1.0, 1.0 / max(1.0, -viewPosition.z), perspective);
    float pixels = aSize * uViewportHeight * projectionMatrix[1][1] * 0.5 * attenuation;
    gl_PointSize = clamp(pixels * ${AI_DRONE_LIGHT_PROFILE.spriteScale.toFixed(1)}, uMinPointSize, uMaxPointSize);
    vColor = color;
    vVisible = smoothstep(0.001, 0.12, aSize);
  }
`;

export const AI_DRONE_FRAGMENT_SHADER = /* glsl */`
  varying vec3 vColor;
  varying float vVisible;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float radius2 = dot(p, p);
    if (radius2 > 0.64 || vVisible < 0.001) discard;
    float radius = sqrt(radius2);
    float core = 1.0 - smoothstep(${AI_DRONE_LIGHT_PROFILE.coreInner.toFixed(2)}, ${AI_DRONE_LIGHT_PROFILE.coreOuter.toFixed(2)}, radius);
    float halo = exp(-radius2 * 12.0) * (1.0 - smoothstep(0.25, 0.64, radius2));
    float alpha = clamp(core * 0.98 + halo * ${AI_DRONE_LIGHT_PROFILE.haloGain.toFixed(2)}, 0.0, 1.0) * vVisible;
    if (alpha < 0.008) discard;
    // The town retains its HDR bloom. Only the compact core may cross its
    // threshold: no broad overbright aureole is fed into that existing pass.
    vec3 light = min(vColor, vec3(${AI_DRONE_LIGHT_PROFILE.peak.toFixed(2)}));
    float brightness = max(vColor.r, max(vColor.g, vColor.b));
    light = mix(light, max(light, vec3(1.10, 1.06, 1.0)), core * 0.12 * min(1.0, brightness));
    gl_FragColor = vec4(light, alpha);
    #include <colorspace_fragment>
  }
`;

export const PAD_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const PAD_FRAGMENT_SHADER = /* glsl */`
  varying vec2 vUv;
  uniform float uTime;
  uniform float uActivity;
  uniform float uReducedMotion;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    float border = 1.0 - smoothstep(0.007, 0.016, abs(max(abs(p.x), abs(p.y)) - 0.94));
    float ring = 1.0 - smoothstep(0.006, 0.014, abs(r - 0.68));
    float center = 1.0 - smoothstep(0.006, 0.013, abs(r - 0.12));
    float crossMark = (1.0 - smoothstep(0.012, 0.021, min(abs(p.x), abs(p.y)))) * (1.0 - smoothstep(0.17, 0.21, r));
    float scanRadius = fract(uTime * 0.17) * 1.2;
    float scan = (1.0 - smoothstep(0.003, 0.04, abs(r - scanRadius))) * (1.0 - uReducedMotion);
    float a = (border * 0.42 + ring * 0.35 + center * 0.35 + crossMark * 0.4 + scan * uActivity * 0.34);
    a *= 0.45 + uActivity * 0.55;
    if (a < 0.001) discard;
    gl_FragColor = vec4(mix(vec3(0.31, 0.61, 0.61), vec3(1.0, 0.68, 0.27), uActivity), a);
    #include <colorspace_fragment>
  }
`;
