import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import type { FireObservation } from '../../types/firenexus';

const EARTH_RADIUS = 1.48;
const INSTANCE_LIMIT = 128;

function buildEarthTexture() {
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

function Earth({ observations, animate }: { observations: FireObservation[]; animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const texture = useMemo(buildEarthTexture, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    if (animate && group.current) group.current.rotation.y += delta * 0.045;
  });
  return <group ref={group}>
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 72, 56]} />
      <meshStandardMaterial map={texture} roughness={0.96} metalness={0.015} />
    </mesh>
    <mesh scale={1.045}>
      <sphereGeometry args={[EARTH_RADIUS, 56, 40]} />
      <meshBasicMaterial color="#70c9f4" transparent opacity={0.105} side={THREE.BackSide} />
    </mesh>
    <HotspotInstances observations={observations} animate={animate} />
  </group>;
}

function HotspotInstances({ observations, animate }: { observations: FireObservation[]; animate: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const points = useMemo(() => {
    if (observations.length <= INSTANCE_LIMIT) return observations;
    const stride = Math.ceil(observations.length / INSTANCE_LIMIT);
    return observations.filter((_, index) => index % stride === 0).slice(0, INSTANCE_LIMIT);
  }, [observations]);

  useLayoutEffect(() => {
    if (!mesh.current) return;
    points.forEach((observation, index) => {
      const lat = THREE.MathUtils.degToRad(observation.latitude);
      const lon = THREE.MathUtils.degToRad(observation.longitude + 180);
      const phi = Math.PI / 2 - lat;
      const radius = EARTH_RADIUS + 0.018;
      dummy.position.set(-radius * Math.sin(phi) * Math.cos(lon), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(lon));
      dummy.lookAt(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(index, dummy.matrix);
      const highFrp = (observation.frp ?? 0) > 100;
      mesh.current!.setColorAt(index, new THREE.Color(highFrp ? '#ff3d2e' : observation.source === 'MODIS' ? '#75d2ef' : '#ff9a5a'));
    });
    mesh.current.count = points.length;
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [dummy, points]);

  useFrame(({ clock }) => {
    if (!animate || !mesh.current) return;
    const pulse = 0.9 + Math.sin(clock.elapsedTime * 2.4) * 0.1;
    points.forEach((observation, index) => {
      const lat = THREE.MathUtils.degToRad(observation.latitude);
      const lon = THREE.MathUtils.degToRad(observation.longitude + 180);
      const phi = Math.PI / 2 - lat;
      const radius = EARTH_RADIUS + 0.018;
      dummy.position.set(-radius * Math.sin(phi) * Math.cos(lon), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(lon));
      dummy.lookAt(0, 0, 0);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(index, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  if (!points.length) return null;
  return <instancedMesh ref={mesh} args={[undefined, undefined, points.length]}>
    <sphereGeometry args={[0.013, 8, 8]} />
    <meshBasicMaterial toneMapped={false} />
  </instancedMesh>;
}

function OrbitingSatellite({ animate }: { animate: boolean }) {
  const orbit = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (animate && orbit.current) orbit.current.rotation.z += delta * 0.12;
  });
  return <group ref={orbit} rotation={[0.82, 0.18, -0.18]}>
    <group position={[2.03, 0, 0]} rotation={[0.1, 0.3, 0.35]}>
      <mesh><boxGeometry args={[0.12, 0.115, 0.105]} /><meshStandardMaterial color="#dce8ef" metalness={0.75} roughness={0.26} /></mesh>
      <mesh position={[0, 0, 0.075]}><boxGeometry args={[0.42, 0.024, 0.018]} /><meshStandardMaterial color="#337da8" metalness={0.4} roughness={0.36} /></mesh>
      <mesh position={[0, 0, -0.075]}><boxGeometry args={[0.42, 0.024, 0.018]} /><meshStandardMaterial color="#337da8" metalness={0.4} roughness={0.36} /></mesh>
      <pointLight color="#8bcfff" intensity={0.35} distance={0.55} />
    </group>
    <mesh><torusGeometry args={[2.03, 0.004, 8, 180]} /><meshBasicMaterial color="#ff8255" transparent opacity={0.42} /></mesh>
    <mesh rotation={[0.82, 0.18, -0.18]}><torusGeometry args={[2.22, 0.002, 6, 180]} /><meshBasicMaterial color="#8bbbd0" transparent opacity={0.17} /></mesh>
  </group>;
}

function Scene({ observations, animate }: { observations: FireObservation[]; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ pointer }) => {
    if (!animate || !root.current) return;
    root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, pointer.x * 0.095, 0.025);
    root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, -pointer.y * 0.055, 0.025);
  });
  return <group ref={root}>
    <ambientLight intensity={0.47} />
    <directionalLight position={[-3, 2.2, 4]} intensity={2.1} color="#b7dafa" />
    <pointLight position={[2, -1, -2]} intensity={5} color="#ff5b39" />
    <Stars radius={70} depth={32} count={850} factor={2} saturation={0.2} fade speed={animate ? 0.18 : 0} />
    <Earth observations={observations} animate={animate} />
    <OrbitingSatellite animate={animate} />
  </group>;
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
  return <Canvas dpr={[1, 1.25]} camera={{ position: [0, 0, 5.2], fov: 38 }} gl={{ antialias: false, powerPreference: 'low-power' }} fallback={<div className="earth-fallback" aria-label="Earth visualization unavailable" />}>
    <Scene observations={observations} animate={!reduceMotion} />
  </Canvas>;
}
