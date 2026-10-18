import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

/*
 * PCSS shader adapted from @react-three/drei 10.7.9, core/softShadows.js.
 * https://github.com/pmndrs/drei
 * The shader and upstream credits are retained; lifecycle handling is local.
 *
 * MIT License
 *
 * Copyright (c) 2020 react-spring
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*  Integration and compilation: @N8Programs
    Inspired by:
     https://github.com/mrdoob/three.js/blob/dev/examples/webgl_shadowmap_pcss.html
     https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-17-efficient-soft-edged-shadows-using
     https://developer.download.nvidia.com/whitepapers/2008/PCSS_Integration.pdf
     https://github.com/mrdoob/three.js/blob/master/examples/webgl_shadowmap_pcss.html [spidersharma03]
     https://spline.design/
   Concept:
     https://www.gamedev.net/tutorials/programming/graphics/contact-hardening-soft-shadows-made-fast-r4906/
   Vogel Disk Implementation:
     https://www.shadertoy.com/view/4l3yRM [ashalah]
   High-Frequency Noise Implementation:
     https://www.shadertoy.com/view/tt3fDH [spawner64]
*/
const pcss = ({
  focus = 0,
  size = 25,
  samples = 10
}, packedDepth) => {
  const depthSample = packedDepth ? 'unpackRGBAToDepth( texture2D( shadowMap, uv + offset ) )' : 'texture2D( shadowMap, uv + offset ).r';
  return `
#define PENUMBRA_FILTER_SIZE float(${size})
#define RGB_NOISE_FUNCTION(uv) (randRGB(uv))
vec3 randRGB(vec2 uv) {
  return vec3(
    fract(sin(dot(uv, vec2(12.75613, 38.12123))) * 13234.76575),
    fract(sin(dot(uv, vec2(19.45531, 58.46547))) * 43678.23431),
    fract(sin(dot(uv, vec2(23.67817, 78.23121))) * 93567.23423)
  );
}

vec3 lowPassRandRGB(vec2 uv) {
  // 3x3 convolution (average)
  // can be implemented as separable with an extra buffer for a total of 6 samples instead of 9
  vec3 result = vec3(0);
  result += RGB_NOISE_FUNCTION(uv + vec2(-1.0, -1.0));
  result += RGB_NOISE_FUNCTION(uv + vec2(-1.0,  0.0));
  result += RGB_NOISE_FUNCTION(uv + vec2(-1.0, +1.0));
  result += RGB_NOISE_FUNCTION(uv + vec2( 0.0, -1.0));
  result += RGB_NOISE_FUNCTION(uv + vec2( 0.0,  0.0));
  result += RGB_NOISE_FUNCTION(uv + vec2( 0.0, +1.0));
  result += RGB_NOISE_FUNCTION(uv + vec2(+1.0, -1.0));
  result += RGB_NOISE_FUNCTION(uv + vec2(+1.0,  0.0));
  result += RGB_NOISE_FUNCTION(uv + vec2(+1.0, +1.0));
  result *= 0.111111111; // 1.0 / 9.0
  return result;
}
vec3 highPassRandRGB(vec2 uv) {
  // by subtracting the low-pass signal from the original signal, we're being left with the high-pass signal
  // hp(x) = x - lp(x)
  return RGB_NOISE_FUNCTION(uv) - lowPassRandRGB(uv) + 0.5;
}


vec2 pcssVogelDiskSample(int sampleIndex, int sampleCount, float angle) {
  const float goldenAngle = 2.399963f; // radians
  float r = sqrt(float(sampleIndex) + 0.5f) / sqrt(float(sampleCount));
  float theta = float(sampleIndex) * goldenAngle + angle;
  float sine = sin(theta);
  float cosine = cos(theta);
  return vec2(cosine, sine) * r;
}
float penumbraSize( const in float zReceiver, const in float zBlocker ) { // Parallel plane estimation
  return (zReceiver - zBlocker) / zBlocker;
}
float findBlocker(sampler2D shadowMap, vec2 uv, float compare, float angle) {
  float texelSize = 1.0 / float(textureSize(shadowMap, 0).x);
  float blockerDepthSum = float(${focus});
  float blockers = 0.0;

  int j = 0;
  vec2 offset = vec2(0.);
  float depth = 0.;

  #pragma unroll_loop_start
  for(int i = 0; i < ${samples}; i ++) {
    offset = (pcssVogelDiskSample(j, ${samples}, angle) * texelSize) * 2.0 * PENUMBRA_FILTER_SIZE;
    depth = ${depthSample};
    if (depth < compare) {
      blockerDepthSum += depth;
      blockers++;
    }
    j++;
  }
  #pragma unroll_loop_end

  if (blockers > 0.0) {
    return blockerDepthSum / blockers;
  }
  return -1.0;
}


float vogelFilter(sampler2D shadowMap, vec2 uv, float zReceiver, float filterRadius, float angle) {
  float texelSize = 1.0 / float(textureSize(shadowMap, 0).x);
  float shadow = 0.0f;
  int j = 0;
  vec2 vogelSample = vec2(0.0);
  vec2 offset = vec2(0.0);
  #pragma unroll_loop_start
  for (int i = 0; i < ${samples}; i++) {
    vogelSample = pcssVogelDiskSample(j, ${samples}, angle) * texelSize;
    offset = vogelSample * (1.0 + filterRadius * float(${size}));
    shadow += step( zReceiver, ${depthSample} );
    j++;
  }
  #pragma unroll_loop_end
  return shadow * 1.0 / ${samples}.0;
}

float PCSS (sampler2D shadowMap, vec4 coords) {
  vec2 uv = coords.xy;
  float zReceiver = coords.z; // Assumed to be eye-space z in this code
  float angle = highPassRandRGB(gl_FragCoord.xy).r * PI2;
  float avgBlockerDepth = findBlocker(shadowMap, uv, zReceiver, angle);
  if (avgBlockerDepth == -1.0) {
    return 1.0;
  }
  float penumbraRatio = penumbraSize(zReceiver, avgBlockerDepth);
  return vogelFilter(shadowMap, uv, zReceiver, 1.25 * penumbraRatio, angle);
}`;
};

function closingBrace(source, opening) {
  if (source[opening] !== '{') return -1;
  let depth = 1;
  for (let i = opening + 1; i < source.length; i++) {
    // Braces in GLSL comments are not part of the function's control flow.
    if (source[i] === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2);
      if (end < 0) return -1;
      i = end;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
    } else if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function replaceFrustumBody(original, start, at, token) {
  const functionOpen = original.indexOf('{', start);
  const functionClose = closingBrace(original, functionOpen);
  const branchOpen = at + token.length - 1;
  const branchClose = closingBrace(original, branchOpen);
  if (functionOpen < 0 || functionClose < 0 || branchOpen <= functionOpen || branchClose >= functionClose || branchClose < 0) return original;
  const beforeBranch = original.slice(functionOpen, branchOpen);
  const afterBranch = original.slice(branchClose + 1, functionClose);
  // Keep Three's initialized accumulator and its final intensity-aware return.
  // Unknown future layouts fail closed instead of injecting an invalid shader.
  if (!/\bfloat\s+shadow\s*=\s*1\.0\s*;/.test(beforeBranch)
    || !/\breturn\s+(?:shadow\s*;|mix\(\s*1\.0\s*,\s*shadow\s*,\s*shadowIntensity\s*\)\s*;)/.test(afterBranch)) return original;
  return original.slice(0, branchOpen + 1)
    + '\n\t\t\tshadow = PCSS( shadowMap, shadowCoord );\n\t\t'
    + original.slice(branchClose);
}

export function createPenumbraPatch(original, { focus = 0.4, size = 18, samples = 8 } = {}) {
  if (![focus, size, samples].every(Number.isFinite) || focus < 0 || size < 0 || !Number.isInteger(samples) || samples < 1 || samples > 32) {
    throw new RangeError('PCSS needs finite non-negative focus/size and 1–32 integer samples.');
  }
  const start = original.lastIndexOf('float getShadow( sampler2D shadowMap');
  const token = 'if ( frustumTest ) {';
  const at = start < 0 ? -1 : original.indexOf(token, start);
  if (at < 0 || !original.includes('#ifdef USE_SHADOWMAP')) return null;
  const singleExit = replaceFrustumBody(original, start, at, token);
  if (singleExit === original) return null;
  const packedDepth = !original.includes('sampler2DShadow');
  // A single return avoids ANGLE/HLSL warnings from an early return followed
  // by unreachable PCF/VSM sampling. All coordinate/bias/intensity logic stays.
  const shader = singleExit
    .replace('#ifdef USE_SHADOWMAP', '#ifdef USE_SHADOWMAP\n' + pcss({ focus, size, samples }, packedDepth));
  return { shader, rawDepth: !packedDepth };
}

// Let Three release its own program references BEFORE removing renderer state.
// Never clear gl.info.programs: composers/backgrounds own programs outside scene.
export function refreshShadowMaterials(scene) {
  const materials = new Set();
  scene.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material?.isMaterial) materials.add(material);
    }
  });
  for (const material of materials) {
    material.dispose();
    material.needsUpdate = true;
  }
}

// ShaderChunk is global even with several renderers. Share a single patch until
// its final owner leaves, so StrictMode and out-of-order unmounts cannot restore
// an orphaned intermediate shader. The first mounted configuration wins.
let installation = null;
export function installSoftPenumbra(gl, scene, invalidate, options) {
  const original = installation?.original ?? THREE.ShaderChunk.shadowmap_pars_fragment;
  const patch = createPenumbraPatch(original, options);
  if (!patch) {
    console.warn('[SoftPenumbra] Unsupported shadow chunk; keeping standard shadows.');
    return () => {};
  }
  if (!installation) {
    installation = { original, ...patch, owners: new Set(), renderers: new Map() };
    THREE.ShaderChunk.shadowmap_pars_fragment = patch.shader;
  } else if (installation.shader !== patch.shader) {
    console.warn('[SoftPenumbra] Another scene owns PCSS settings; reusing its active configuration.');
  }
  const current = installation;
  let renderer = current.renderers.get(gl);
  if (!renderer) {
    renderer = { previousType: gl.shadowMap.type, owners: 0 };
    current.renderers.set(gl, renderer);
  }
  renderer.owners++;
  const owner = { gl, scene };
  current.owners.add(owner);
  if (current.rawDepth) gl.shadowMap.type = THREE.BasicShadowMap;
  renderer.appliedType = gl.shadowMap.type;
  refreshShadowMaterials(scene);
  gl.shadowMap.needsUpdate = true;
  invalidate();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    current.owners.delete(owner);
    if (current.owners.size === 0) {
      if (THREE.ShaderChunk.shadowmap_pars_fragment === current.shader) {
        THREE.ShaderChunk.shadowmap_pars_fragment = current.original;
      }
      if (installation === current) installation = null;
    }
    if (--renderer.owners === 0) {
      if (gl.shadowMap.type === renderer.appliedType) gl.shadowMap.type = renderer.previousType;
      current.renderers.delete(gl);
    }
    refreshShadowMaterials(scene);
    gl.shadowMap.needsUpdate = true;
    // No gl.compile() during cleanup: the renderer may already be unmounting.
    // A surviving canvas recompiles lazily on its next invalidated frame.
    invalidate();
  };
}

export default function SoftPenumbra({ focus = 0.4, samples = 8, size = 18 }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => installSoftPenumbra(gl, scene, invalidate, { focus, samples, size }),
    [gl, scene, invalidate, focus, samples, size]);
  return null;
}

