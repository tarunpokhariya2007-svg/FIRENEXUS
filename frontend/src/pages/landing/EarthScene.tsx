import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { FireObservation } from '../../types/firenexus';

/**
 * FIRENEXUS landing-page globe.
 *
 * - Earth surface: locally bundled NASA-derived maps from /public/textures (day, clouds, bump or normal,
 *   ocean specular, night lights). Every map except `day` is optional; a missing map just switches that
 *   one feature off. A missing `day` map switches the whole globe to the original procedural look.
 * - Wildfire hotspots: drawn ONLY from real backend observations. No observations -> no hotspots.
 * - All procedural noise is seeded and deterministic (no runtime randomness).
 */

const EARTH_RADIUS = 1.48;
const INSTANCE_LIMIT = 128;
const HALO_SCALE = 1.14;
const SUN_POSITION = new THREE.Vector3(-3, 2.2, 4);
const SUN_DIRECTION = SUN_POSITION.clone().normalize();
const TEXTURE_DIR = `${import.meta.env.BASE_URL}textures/`;

type TextureKey = 'day' | 'clouds' | 'bump' | 'normal' | 'specular' | 'night';
type Tier = '2k' | '4k';
type SunUniform = { value: THREE.Vector3 };
type TimeUniform = { value: number };
type EarthMaps = Partial<Record<TextureKey, THREE.Texture>> & { day: THREE.Texture };
type MapsState =
  | { status: 'loading' }
  | { status: 'fallback' }
  | { status: 'ready'; maps: EarthMaps };

const TEXTURE_FILES: Record<TextureKey, { name: string; srgb: boolean }> = {
  day: { name: 'earth_day', srgb: true },
  clouds: { name: 'earth_clouds', srgb: false },
  bump: { name: 'earth_bump', srgb: false },
  normal: { name: 'earth_normal', srgb: false },
  specular: { name: 'earth_specular', srgb: false },
  night: { name: 'earth_night', srgb: true },
};

/* ------------------------------------------------------------------ */
/* Texture loading                                                     */
/* ------------------------------------------------------------------ */

function pickTier(gl: THREE.WebGLRenderer): Tier {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMemory = memory !== undefined && memory < 4;
  return coarsePointer || lowMemory || gl.capabilities.maxTextureSize < 4096 ? '2k' : '4k';
}

/** Loads the Earth maps once, in parallel, from same-origin files. Resolves to `fallback` if `day` is absent. */
function useEarthMaps(): MapsState {
  const gl = useThree((state) => state.gl);
  const [state, setState] = useState<MapsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const loaded: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader();
    const tier = pickTier(gl);
    const canUse4k = gl.capabilities.maxTextureSize >= 4096;
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());

    const load = async (key: TextureKey): Promise<THREE.Texture | null> => {
      const { name, srgb } = TEXTURE_FILES[key];
      const urls = tier === '2k'
        ? [`${TEXTURE_DIR}${name}_2k.jpg`, ...(canUse4k ? [`${TEXTURE_DIR}${name}_4k.jpg`] : [])]
        : [`${TEXTURE_DIR}${name}_4k.jpg`];
      for (const url of urls) {
        try {
          const texture = await loader.loadAsync(url);
          if (cancelled) { texture.dispose(); return null; }
          texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.anisotropy = anisotropy;
          loaded.push(texture);
          return texture;
        } catch {
          // Missing or undecodable file: try the next candidate, otherwise report "absent".
        }
      }
      return null;
    };

    (async () => {
      const [day, clouds, bump, normal, specular, night] = await Promise.all(
        (['day', 'clouds', 'bump', 'normal', 'specular', 'night'] as TextureKey[]).map(load),
      );
      if (cancelled) return;
      if (!day) {
        loaded.forEach((texture) => texture.dispose());
        loaded.length = 0;
        setState({ status: 'fallback' });
        return;
      }
      setState({
        status: 'ready',
        maps: {
          day,
          ...(clouds ? { clouds } : {}),
          ...(bump ? { bump } : {}),
          ...(normal ? { normal } : {}),
          ...(specular ? { specular } : {}),
          ...(night ? { night } : {}),
        },
      });
    })();

    return () => {
      cancelled = true;
      loaded.forEach((texture) => texture.dispose());
    };
  }, [gl]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Procedural fallbacks (deterministic)                                */
/* ------------------------------------------------------------------ */

function buildFallbackEarthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const ocean = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  ocean.addColorStop(0, '#071c30');
  ocean.addColorStop(0.48, '#123c59');
  ocean.addColorStop(1, '#061727');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Low relief, deliberately subdued cartographic land texture. Observation
  // locations are supplied separately from the backend and never generated here.
  const land = ctx.createLinearGradient(0, 75, canvas.width, 700);
  land.addColorStop(0, '#315b55');
  land.addColorStop(0.42, '#456c5b');
  land.addColorStop(0.72, '#6b8062');
  land.addColorStop(1, '#254a4a');
  ctx.fillStyle = land;
  const continents = [
    [[94,123],[150,92],[212,106],[247,148],[293,157],[311,207],[275,249],[257,294],[219,320],[199,374],[166,351],[151,304],[111,287],[90,238],[64,190]],
    [[252,373],[291,383],[317,428],[304,496],[281,560],[260,627],[234,671],[214,615],[219,552],[198,507],[211,453]],
    [[672,124],[734,105],[784,123],[821,106],[879,132],[911,164],[952,158],[988,185],[1025,171],[1070,191],[1119,175],[1171,197],[1212,226],[1257,252],[1291,296],[1267,328],[1218,318],[1194,347],[1144,335],[1110,366],[1070,349],[1037,377],[997,351],[962,368],[938,329],[899,313],[887,278],[851,267],[828,226],[785,217],[756,190],[706,185]],
    [[930,372],[977,366],[1014,390],[1030,433],[1014,475],[992,524],[972,579],[941,609],[921,571],[909,525],[890,477],[896,427]],
    [[1109,429],[1154,407],[1203,414],[1238,441],[1228,477],[1185,492],[1148,477],[1115,460]],
    [[1314,481],[1360,463],[1401,485],[1420,521],[1403,557],[1362,565],[1327,536]],
  ];
  continents.forEach((points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
  });

  // Fine latitude / longitude structure gives the globe a restrained GIS feel.
  ctx.strokeStyle = 'rgba(143, 191, 207, .13)';
  ctx.lineWidth = 1.2;
  for (let y = 0; y <= canvas.height; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  for (let x = 0; x <= canvas.width; x += 96) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

/** Integer lattice hash -> [0, 1). Same inputs always give the same value. */
function latticeHash(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise that tiles horizontally every `period` cells so the cloud map has no seam at the antimeridian. */
function tiledNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const a = latticeHash(x0, yi, seed);
  const b = latticeHash(x1, yi, seed);
  const c = latticeHash(x0, yi + 1, seed);
  const d = latticeHash(x1, yi + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function buildProceduralClouds() {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  if (!ctx) return texture;
  const image = ctx.createImageData(width, height);
  for (let py = 0; py < height; py += 1) {
    const v = py / height;
    // Fewer clouds toward the poles, a drier band near the subtropics.
    const latitude = Math.abs(v - 0.5) * 2;
    const bandBias = 0.04 * Math.cos(latitude * Math.PI * 3);
    for (let px = 0; px < width; px += 1) {
      const u = px / width;
      let amplitude = 0.55;
      let total = 0;
      let norm = 0;
      for (let octave = 0; octave < 5; octave += 1) {
        const period = 4 * 2 ** octave;
        total += amplitude * tiledNoise(u * period, v * period * 0.5, period, 17 + octave * 31);
        norm += amplitude;
        amplitude *= 0.5;
      }
      const field = total / norm + bandBias - 0.1 * latitude * latitude;
      const density = THREE.MathUtils.smoothstep(field, 0.5, 0.74);
      const value = Math.round(density * 255);
      const offset = (py * width + px) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  texture.needsUpdate = true;
  texture.anisotropy = 2;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Earth surface                                                       */
/* ------------------------------------------------------------------ */

function FallbackEarthMaterial() {
  const texture = useMemo(buildFallbackEarthTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <meshStandardMaterial map={texture} roughness={0.96} metalness={0.015} />;
}

function RealisticEarthMaterial({ maps, sun }: { maps: EarthMaps; sun: SunUniform }) {
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: maps.day, roughness: 0.9, metalness: 0 });
    if (maps.normal) {
      m.normalMap = maps.normal;
      m.normalScale.set(0.9, 0.9);
    } else if (maps.bump) {
      m.bumpMap = maps.bump;
      m.bumpScale = 1.4;
    }
    const hasSpecular = Boolean(maps.specular);
    const hasNight = Boolean(maps.night);
    m.customProgramCacheKey = () => `firenexus-earth-${hasSpecular ? 1 : 0}-${hasNight ? 1 : 0}`;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSunView = sun;
      if (maps.specular) shader.uniforms.uSpecMap = { value: maps.specular };
      if (maps.night) shader.uniforms.uNightMap = { value: maps.night };
      let fragment = shader.fragmentShader;
      fragment = fragment.replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunView;
${hasSpecular ? 'uniform sampler2D uSpecMap;' : ''}
${hasNight ? 'uniform sampler2D uNightMap;' : ''}`,
      );
      if (hasSpecular) {
        // Ocean mask: bright in the specular map -> smooth, glinting water; land stays matte.
        fragment = fragment.replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(0.94, 0.16, texture2D(uSpecMap, vMapUv).g);`,
        );
      }
      fragment = fragment.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float sunFacing = dot(normalize(vNormal), normalize(uSunView));
${hasNight ? `float nightSide = smoothstep(0.04, -0.2, sunFacing);
totalEmissiveRadiance += texture2D(uNightMap, vMapUv).rgb * nightSide * 1.35;` : ''}`,
      );
      // Warm twilight band along the day/night terminator.
      fragment = fragment.replace(
        '#include <opaque_fragment>',
        `float twilight = 1.0 - smoothstep(0.0, 0.2, abs(sunFacing - 0.02));
outgoingLight += vec3(1.0, 0.42, 0.18) * twilight * 0.06;
#include <opaque_fragment>`,
      );
      shader.fragmentShader = fragment;
    };
    return m;
  }, [maps, sun]);
  useEffect(() => () => material.dispose(), [material]);
  return <primitive object={material} attach="material" />;
}

function CloudLayer({ map, animate }: { map?: THREE.Texture; animate: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const procedural = useMemo(() => (map ? null : buildProceduralClouds()), [map]);
  useEffect(() => () => procedural?.dispose(), [procedural]);
  useFrame((_, delta) => {
    // Clouds drift slightly faster than the surface, as a separate layer would.
    if (animate && mesh.current) mesh.current.rotation.y += delta * 0.012;
  });
  const alphaMap = map ?? procedural;
  if (!alphaMap) return null;
  return <mesh ref={mesh} renderOrder={2}>
    <sphereGeometry args={[EARTH_RADIUS * 1.01, 96, 64]} />
    <meshStandardMaterial color="#ffffff" alphaMap={alphaMap} transparent opacity={0.88} roughness={1} metalness={0} depthWrite={false} />
  </mesh>;
}

/* ------------------------------------------------------------------ */
/* Atmosphere                                                          */
/* ------------------------------------------------------------------ */

const atmosphereVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// Outer halo, seen through the back faces of a slightly larger sphere. Glow peaks at the Earth's limb.
const haloFragment = /* glsl */ `
uniform vec3 uSunView;
uniform float uLimb;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float t = clamp(-dot(n, normalize(vV)), 0.0, 1.0);
  float glow = pow(clamp(t / uLimb, 0.0, 1.0), 2.6);
  float sun = dot(n, normalize(uSunView));
  float lit = smoothstep(-0.45, 0.55, sun);
  float dusk = 1.0 - smoothstep(0.0, 0.35, abs(sun + 0.05));
  vec3 color = mix(vec3(0.22, 0.55, 1.0), vec3(1.0, 0.45, 0.2), dusk * 0.55);
  gl_FragColor = vec4(color, glow * (0.12 + 0.88 * lit) * 0.85);
}`;

// Thin fresnel rim hugging the surface, strongest on the sunlit limb.
const rimFragment = /* glsl */ `
uniform vec3 uSunView;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float f = 1.0 - clamp(dot(n, normalize(vV)), 0.0, 1.0);
  float rim = pow(f, 3.2);
  float lit = smoothstep(-0.3, 0.6, dot(n, normalize(uSunView)));
  gl_FragColor = vec4(0.35, 0.68, 1.0, rim * (0.1 + 0.9 * lit) * 0.75);
}`;

function Atmosphere({ sun }: { sun: SunUniform }) {
  const [halo, rim] = useMemo(() => {
    const common = { vertexShader: atmosphereVertex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    return [
      new THREE.ShaderMaterial({ ...common, fragmentShader: haloFragment, side: THREE.BackSide, uniforms: { uSunView: sun, uLimb: { value: Math.sqrt(1 - 1 / (HALO_SCALE * HALO_SCALE)) } } }),
      new THREE.ShaderMaterial({ ...common, fragmentShader: rimFragment, side: THREE.FrontSide, uniforms: { uSunView: sun } }),
    ];
  }, [sun]);
  useEffect(() => () => { halo.dispose(); rim.dispose(); }, [halo, rim]);
  return <>
    <mesh scale={HALO_SCALE} material={halo}><sphereGeometry args={[EARTH_RADIUS, 64, 48]} /></mesh>
    <mesh scale={1.012} material={rim}><sphereGeometry args={[EARTH_RADIUS, 64, 48]} /></mesh>
  </>;
}

/* ------------------------------------------------------------------ */
/* Wildfire hotspots (real backend observations only)                  */
/* ------------------------------------------------------------------ */

const hotspotVertex = /* glsl */ `
attribute float aPhase;
attribute float aIntensity;
attribute vec3 aColor;
varying vec2 vUv;
varying float vPhase;
varying float vIntensity;
varying vec3 vColor;
void main() {
  vUv = uv;
  vPhase = aPhase;
  vIntensity = aIntensity;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const hotspotFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
varying float vIntensity;
varying vec3 vColor;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  if (d > 1.0) discard;
  float t = uTime + vPhase * 6.2831853;
  float flicker = 0.8 + 0.2 * sin(t * 2.4) * sin(t * 1.3 + 1.7);
  float core = exp(-d * d * 38.0);
  float halo = exp(-d * d * 7.0) * 0.55 * flicker;
  float cycle = fract(uTime * 0.3 + vPhase);
  float ring = smoothstep(0.08, 0.0, abs(d - cycle * 0.95)) * (1.0 - cycle) * vIntensity;
  float a = (core * 1.2 + halo) * (0.6 + 0.4 * vIntensity) + ring * 0.8;
  vec3 color = mix(vColor, vec3(1.0, 0.93, 0.78), core * 0.7);
  gl_FragColor = vec4(color, clamp(a, 0.0, 1.0));
}`;

function HotspotInstances({ observations, time }: { observations: FireObservation[]; time: TimeUniform }) {
  const points = useMemo(() => {
    if (observations.length <= INSTANCE_LIMIT) return observations;
    const stride = Math.ceil(observations.length / INSTANCE_LIMIT);
    return observations.filter((_, index) => index % stride === 0).slice(0, INSTANCE_LIMIT);
  }, [observations]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: hotspotVertex,
    fragmentShader: hotspotFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), [time]);

  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const phase = new Float32Array(points.length);
    const intensity = new Float32Array(points.length);
    const color = new Float32Array(points.length * 3);
    const tint = new THREE.Color();
    points.forEach((observation, index) => {
      // Phase comes from the index (golden-ratio stagger), so the pulse timing is deterministic.
      phase[index] = (index * 0.6180339887) % 1;
      intensity[index] = 0.3 + 0.7 * Math.min(1, Math.max(0, (observation.frp ?? 0) / 150));
      const highFrp = (observation.frp ?? 0) > 100;
      tint.set(highFrp ? '#ff3d2e' : observation.source === 'MODIS' ? '#75d2ef' : '#ff9a5a');
      color.set([tint.r, tint.g, tint.b], index * 3);
    });
    plane.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    plane.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(intensity, 1));
    plane.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
    return plane;
  }, [points]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const dummy = new THREE.Object3D();
    points.forEach((observation, index) => {
      const lat = THREE.MathUtils.degToRad(observation.latitude);
      const lon = THREE.MathUtils.degToRad(observation.longitude + 180);
      const phi = Math.PI / 2 - lat;
      const radius = EARTH_RADIUS + 0.012;
      dummy.position.set(-radius * Math.sin(phi) * Math.cos(lon), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(lon));
      dummy.lookAt(0, 0, 0);
      const strength = 0.3 + 0.7 * Math.min(1, Math.max(0, (observation.frp ?? 0) / 150));
      dummy.scale.setScalar(0.11 + 0.09 * strength);
      dummy.updateMatrix();
      target.setMatrixAt(index, dummy.matrix);
    });
    target.instanceMatrix.needsUpdate = true;
  }, [points, geometry]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  if (!points.length) return null;
  return <instancedMesh key={points.length} ref={mesh} args={[geometry, material, points.length]} renderOrder={3} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* Earth group                                                         */
/* ------------------------------------------------------------------ */

function Earth({ observations, animate, state, sun, time }: { observations: FireObservation[]; animate: boolean; state: MapsState; sun: SunUniform; time: TimeUniform }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (animate && group.current) group.current.rotation.y += delta * 0.045;
  });
  return <group ref={group}>
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 128, 96]} />
      {state.status === 'ready'
        ? <RealisticEarthMaterial maps={state.maps} sun={sun} />
        : state.status === 'fallback'
          ? <FallbackEarthMaterial />
          : <meshStandardMaterial color="#06182a" roughness={0.95} />}
    </mesh>
    {state.status === 'ready' && <CloudLayer map={state.maps.clouds} animate={animate} />}
    {state.status === 'fallback' && <CloudLayer animate={animate} />}
    <HotspotInstances observations={observations} time={time} />
  </group>;
}

/* ------------------------------------------------------------------ */
/* Satellite                                                           */
/* ------------------------------------------------------------------ */

function OrbitingSatellite({ animate }: { animate: boolean }) {
  const orbit = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshBasicMaterial>(null);
  const trail = useMemo(() => {
    const segments = 56;
    const positions = new Float32Array(segments * 3);
    const colors = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i += 1) {
      const angle = -(i / (segments - 1)) * 0.6;
      positions.set([2.03 * Math.cos(angle), 2.03 * Math.sin(angle), 0], i * 3);
      const fade = (1 - i / (segments - 1)) ** 2.2;
      colors.set([1 * fade, 0.52 * fade, 0.3 * fade], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    return new THREE.Line(geometry, material);
  }, []);
  useEffect(() => () => { trail.geometry.dispose(); (trail.material as THREE.Material).dispose(); }, [trail]);

  useFrame(({ clock }, delta) => {
    if (animate && orbit.current) orbit.current.rotation.z += delta * 0.12;
    if (beacon.current) beacon.current.opacity = animate ? (Math.sin(clock.elapsedTime * 3.2) > 0.55 ? 1 : 0.18) : 0.8;
  });

  // Local axes of the spacecraft: +x radial (away from Earth), y along track, z across track.
  const panelSegments = [0, 1, 2];
  return <group ref={orbit} rotation={[0.82, 0.18, -0.18]}>
    <group position={[2.03, 0, 0]} rotation={[0.1, 0.3, 0.35]} scale={0.8}>
      <mesh><boxGeometry args={[0.1, 0.095, 0.11]} /><meshStandardMaterial color="#dce8ef" metalness={0.75} roughness={0.26} /></mesh>
      <mesh position={[-0.01, 0, 0]}><boxGeometry args={[0.104, 0.099, 0.03]} /><meshStandardMaterial color="#b88a3e" metalness={0.8} roughness={0.35} /></mesh>
      <mesh position={[-0.075, 0, 0]}><boxGeometry args={[0.05, 0.06, 0.07]} /><meshStandardMaterial color="#1a232d" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0.09, 0, 0]}><cylinderGeometry args={[0.004, 0.004, 0.08, 8]} /><meshStandardMaterial color="#dce8ef" metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0.135, 0, 0]}><sphereGeometry args={[0.009, 10, 10]} /><meshBasicMaterial ref={beacon} color="#ff5a3c" transparent toneMapped={false} /></mesh>
      {[-1, 1].map((side) => <group key={side} scale={[1, 1, side]}>
        <mesh position={[0, 0, 0.1]}><boxGeometry args={[0.012, 0.012, 0.09]} /><meshStandardMaterial color="#9fb0bc" metalness={0.8} roughness={0.3} /></mesh>
        {panelSegments.map((i) => <mesh key={i} position={[0, 0, 0.15 + i * 0.066]}>
          <boxGeometry args={[0.004, 0.14, 0.062]} />
          <meshStandardMaterial color="#1d4f7a" emissive="#0a2a44" emissiveIntensity={0.35} metalness={0.6} roughness={0.32} />
        </mesh>)}
      </group>)}
      <pointLight color="#8bcfff" intensity={0.35} distance={0.55} />
    </group>
    <primitive object={trail} />
    <mesh><torusGeometry args={[2.03, 0.004, 8, 180]} /><meshBasicMaterial color="#ff8255" transparent opacity={0.42} /></mesh>
    <mesh rotation={[0.82, 0.18, -0.18]}><torusGeometry args={[2.22, 0.002, 6, 180]} /><meshBasicMaterial color="#8bbbd0" transparent opacity={0.17} /></mesh>
  </group>;
}

/* ------------------------------------------------------------------ */
/* Scene + canvas                                                      */
/* ------------------------------------------------------------------ */

function Scene({ observations, animate }: { observations: FireObservation[]; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  const state = useEarthMaps();
  const camera = useThree((s) => s.camera);
  const sun = useMemo<SunUniform>(() => ({ value: new THREE.Vector3() }), []);
  const time = useMemo<TimeUniform>(() => ({ value: 0 }), []);
  const realistic = state.status === 'ready';

  useFrame(({ pointer }, delta) => {
    // Sun direction expressed in view space, shared by the surface and atmosphere shaders.
    sun.value.copy(SUN_DIRECTION).transformDirection(camera.matrixWorldInverse);
    if (animate) time.value += delta;
    if (!animate || !root.current) return;
    root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, pointer.x * 0.095, 0.025);
    root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, -pointer.y * 0.055, 0.025);
  });

  return <>
    {/* Lights are fixed in world space so the terminator stays put while the globe turns. */}
    <ambientLight intensity={realistic ? 0.2 : 0.47} />
    <directionalLight position={SUN_POSITION} intensity={realistic ? 2.8 : 2.1} color={realistic ? '#fff1de' : '#b7dafa'} />
    <directionalLight position={[4, -1.2, -2.5]} intensity={realistic ? 0.35 : 0} color="#3a6ea8" />
    <pointLight position={[2, -1, -2]} intensity={5} color="#ff5b39" />
    <group ref={root}>
      <Stars radius={70} depth={32} count={850} factor={2} saturation={0.2} fade speed={animate ? 0.18 : 0} />
      <Earth observations={observations} animate={animate} state={state} sun={sun} time={time} />
      <Atmosphere sun={sun} />
      <OrbitingSatellite animate={animate} />
    </group>
  </>;
}

export default function EarthScene({ observations }: { observations: FireObservation[] }) {
  const [mobileFallback, setMobileFallback] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 720px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setMobileFallback(mobile.matches); setReduceMotion(reduced.matches); };
    update();
    mobile.addEventListener('change', update);
    reduced.addEventListener('change', update);
    return () => { mobile.removeEventListener('change', update); reduced.removeEventListener('change', update); };
  }, []);

  if (mobileFallback) return <div className="earth-mobile-globe" aria-label="Illustrated Earth globe with orbital path" />;
  return <Canvas
    dpr={[1, 1.5]}
    camera={{ position: [0, 0, 5.2], fov: 38 }}
    gl={{ antialias: true, powerPreference: 'default' }}
    onCreated={({ gl }) => { gl.toneMappingExposure = 1.05; }}
    fallback={<div className="earth-fallback" aria-label="Earth visualization unavailable" />}
  >
    <Scene observations={observations} animate={!reduceMotion} />
  </Canvas>;
}
