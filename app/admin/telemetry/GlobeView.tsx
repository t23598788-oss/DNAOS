"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Real-Time 3D Hologram Network Topology (owner, 2026-07-26 — "FINAL
// ARCHITECTURE: 3D HOLOGRAM NETWORK TOPOLOGY WITH DYNAMIC GLOW"). Honest
// scope note: there are no downloadable 3D model assets in this repo/build
// pipeline (no GLTF loader wired, no asset CDN this app depends on) — the
// robot head / cloud mesh / satellite / device shapes below are built
// procedurally from primitive Three.js geometry, not imported model files.
// This keeps the whole view self-contained (no network fetch dependency at
// render time) while still giving each real node its own distinct
// silhouette, per the spec. Bloom (real UnrealBloomPass, shipped inside the
// `three` package already installed — no new dependency) gives the
// "neon glow when active / dim when idle" effect: threshold is tuned so
// only high-emissive (active) objects actually bloom, idle geometry stays
// flat, matching "Idle = dimmed, Active = high-intensity glow" from spec.

export type NodeId = "local_edge" | "cloud_core" | "external_line";
export type NodeKind = "robot" | "cloud" | "satellite";

export interface TelemetryNode {
  id: NodeId;
  kind: NodeKind;
  label: string;
  lat: number;
  lng: number;
  status: "OK" | "BROKEN";
}

export interface DeviceMarker {
  id: string;
  lat: number;
  lng: number;
}

export interface BeamEvent {
  from: NodeId;
  to: NodeId;
  durationMs: number;
  color?: string;
}

interface Props {
  nodes: TelemetryNode[];
  devices: DeviceMarker[];
  beamQueue: BeamEvent[];
  onBeamConsumed: () => void;
}

const RADIUS = 100;
const ACTIVE_HOLD_MS = 1200; // how long a node stays "lit" after a beam touches it

function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function orientToSurface(group: THREE.Object3D, normal: THREE.Vector3) {
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
  group.quaternion.copy(quat);
}

function emissiveMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, emissive: new THREE.Color(color), emissiveIntensity: 0.15, transparent: true, opacity: 0.55,
    roughness: 0.4, metalness: 0.2,
  });
}

// 🤖 Local AI Engine — a head block + two eye lights + antenna.
function buildRobotHead(color: string): { group: THREE.Group; mats: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];

  const headMat = emissiveMaterial(color);
  mats.push(headMat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(4, 3.6, 3.2), headMat);
  head.position.y = 2.2;
  group.add(head);

  const eyeMat = emissiveMaterial("#7dd3fc");
  mats.push(eyeMat);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), eyeMat);
    eye.position.set(side * 1.1, 2.3, 1.65);
    group.add(eye);
  }

  const antennaMat = emissiveMaterial(color);
  mats.push(antennaMat);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6), antennaMat);
  antenna.position.y = 4.6;
  group.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), antennaMat);
  tip.position.y = 5.5;
  group.add(tip);

  return { group, mats };
}

// ☁️ Cloud Core — a cluster of overlapping spheres.
function buildCloudMesh(color: string): { group: THREE.Group; mats: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  const puffs: [number, number, number, number][] = [
    [0, 2, 0, 2.2], [1.6, 2.4, 0.3, 1.7], [-1.6, 2.3, -0.2, 1.7],
    [0.7, 3.1, -0.5, 1.5], [-0.8, 3.0, 0.4, 1.4],
  ];
  for (const [x, y, z, r] of puffs) {
    const mat = emissiveMaterial(color);
    mats.push(mat);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat);
    puff.position.set(x, y, z);
    group.add(puff);
  }
  return { group, mats };
}

// 🛰️ Satellite — body + solar panels + dish, floats above the surface.
function buildSatellite(color: string): { group: THREE.Group; mats: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];

  const bodyMat = emissiveMaterial(color);
  mats.push(bodyMat);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 3.2), bodyMat);
  body.position.y = 3;
  group.add(body);

  const panelMat = emissiveMaterial("#38bdf8");
  mats.push(panelMat);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.6, 0.15), panelMat);
    panel.position.set(side * 3.2, 3, 0);
    group.add(panel);
  }

  const dishMat = emissiveMaterial(color);
  mats.push(dishMat);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(1, 1.2, 12, 1, true), dishMat);
  dish.rotation.x = Math.PI;
  dish.position.set(0, 4.6, 1.2);
  group.add(dish);

  return { group, mats };
}

function buildDevice(): { group: THREE.Group; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({
    color: "#94a3b8", emissive: new THREE.Color("#94a3b8"), emissiveIntensity: 0.1,
    transparent: true, opacity: 0.5,
  });
  const group = new THREE.Group();
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.15), mat);
  phone.position.y = 0.7;
  group.add(phone);
  return { group, mat };
}

interface NodeRig {
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  baseColor: string;
  lastActiveAt: number;
}

export default function GlobeView({ nodes, devices, beamQueue, onBeamConsumed }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rigsRef = useRef<Map<NodeId, NodeRig>>(new Map());
  const nodesLatestRef = useRef<TelemetryNode[]>(nodes);
  const activeBeamsRef = useRef<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; start: number; duration: number; trail: THREE.Line; from: NodeId; to: NodeId }[]>([]);
  const pendingRef = useRef<BeamEvent[]>(beamQueue);

  useEffect(() => { nodesLatestRef.current = nodes; }, [nodes]);
  useEffect(() => { pendingRef.current = beamQueue; }, [beamQueue]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#050510");

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, 60, 260);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Real bloom pipeline — threshold tuned so idle (dim) geometry never
    // blooms; only nodes pushed to high emissiveIntensity (active) do.
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight), 1.4, 0.6, 0.35,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const group = new THREE.Group();
    scene.add(group);

    const earthGeo = new THREE.SphereGeometry(RADIUS, 48, 48);
    const earthMat = new THREE.MeshBasicMaterial({ color: "#0c1a2e", transparent: true, opacity: 0.9 });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    group.add(earth);

    const wireGeo = new THREE.SphereGeometry(RADIUS + 0.3, 24, 16);
    const wireMat = new THREE.MeshBasicMaterial({ color: "#1e3a5f", wireframe: true, transparent: true, opacity: 0.35 });
    group.add(new THREE.Mesh(wireGeo, wireMat));

    group.add(new THREE.AmbientLight("#ffffff", 0.8));
    const sun = new THREE.DirectionalLight("#ffffff", 0.6);
    sun.position.set(120, 80, 100);
    group.add(sun);

    // ── Real nodes, real models, real GPS position ──
    for (const n of nodes) {
      const altitude = n.kind === "satellite" ? 26 : 1.5; // satellites float above the surface, per spec
      const pos = latLngToVec3(n.lat, n.lng, RADIUS + altitude);
      const normal = pos.clone().normalize();
      const color = n.status === "BROKEN" ? "#ef4444" : "#22c55e";

      const built = n.kind === "robot" ? buildRobotHead(color)
        : n.kind === "cloud" ? buildCloudMesh(color)
        : buildSatellite(color);

      built.group.position.copy(pos);
      orientToSurface(built.group, normal);
      group.add(built.group);

      rigsRef.current.set(n.id, { group: built.group, mats: built.mats, baseColor: color, lastActiveAt: 0 });

      // If floating (satellite), draw a thin tether down to its real ground
      // GPS point so it reads as "orbiting above its real location", not
      // randomly placed.
      if (n.kind === "satellite") {
        const groundPos = latLngToVec3(n.lat, n.lng, RADIUS + 0.3);
        const tetherGeo = new THREE.BufferGeometry().setFromPoints([groundPos, pos]);
        const tetherMat = new THREE.LineBasicMaterial({ color: "#1e3a5f", transparent: true, opacity: 0.4 });
        group.add(new THREE.Line(tetherGeo, tetherMat));
      }
    }

    // ── Real customer device markers (📱), real GPS from customer_sites ──
    for (const d of devices) {
      const pos = latLngToVec3(d.lat, d.lng, RADIUS + 1);
      const normal = pos.clone().normalize();
      const { group: devGroup } = buildDevice();
      devGroup.position.copy(pos);
      orientToSurface(devGroup, normal);
      group.add(devGroup);
    }

    let raf = 0;

    function spawnBeam(ev: BeamEvent) {
      const fromNode = nodesLatestRef.current.find((n) => n.id === ev.from);
      const toNode = nodesLatestRef.current.find((n) => n.id === ev.to);
      if (!fromNode || !toNode) return;
      const fromAlt = fromNode.kind === "satellite" ? 26 : 1.5;
      const toAlt = toNode.kind === "satellite" ? 26 : 1.5;
      const p0 = latLngToVec3(fromNode.lat, fromNode.lng, RADIUS + fromAlt);
      const p1 = latLngToVec3(toNode.lat, toNode.lng, RADIUS + toAlt);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      mid.setLength(RADIUS + 1.5 + p0.distanceTo(p1) * 0.5);
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);

      const trailGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
      const trailMat = new THREE.LineBasicMaterial({ color: ev.color ?? "#38bdf8", transparent: true, opacity: 0.5 });
      const trail = new THREE.Line(trailGeo, trailMat);
      group.add(trail);

      const pulseMat = new THREE.MeshStandardMaterial({
        color: ev.color ?? "#38bdf8", emissive: new THREE.Color(ev.color ?? "#38bdf8"), emissiveIntensity: 4,
      });
      const pulse = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), pulseMat);
      pulse.position.copy(p0);
      group.add(pulse);

      activeBeamsRef.current.push({
        mesh: pulse, curve, start: performance.now(), duration: Math.max(300, ev.durationMs), trail,
        from: ev.from, to: ev.to,
      });

      const now = Date.now();
      const fromRig = rigsRef.current.get(ev.from);
      const toRig = rigsRef.current.get(ev.to);
      if (fromRig) fromRig.lastActiveAt = now;
      if (toRig) toRig.lastActiveAt = now + ev.durationMs; // target lights up on arrival
    }

    function updateNodeGlow() {
      const now = Date.now();
      for (const n of nodesLatestRef.current) {
        const rig = rigsRef.current.get(n.id);
        if (!rig) continue;
        const isActive = now - rig.lastActiveAt < ACTIVE_HOLD_MS;
        const brokenColor = n.status === "BROKEN" ? "#ef4444" : rig.baseColor;
        for (const mat of rig.mats) {
          mat.emissiveIntensity = isActive ? 3.2 : (n.status === "BROKEN" ? 1.2 : 0.15);
          mat.opacity = isActive ? 1 : (n.status === "BROKEN" ? 0.85 : 0.5);
          if (n.status === "BROKEN") mat.emissive.set("#ef4444");
        }
        // Gentle "breathing" scale on the whole rig while idle, life-like
        // without implying activity that isn't real.
        const breathe = isActive ? 1.15 : 1 + Math.sin(now / 900 + rig.group.position.x) * 0.03;
        rig.group.scale.setScalar(breathe);
      }
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      earth.rotation.y += 0.0004;

      updateNodeGlow();

      if (pendingRef.current.length > 0) {
        const queued = pendingRef.current;
        pendingRef.current = [];
        for (const ev of queued) spawnBeam(ev);
        onBeamConsumed();
      }

      const now = performance.now();
      activeBeamsRef.current = activeBeamsRef.current.filter((b) => {
        const t = (now - b.start) / b.duration;
        if (t >= 1) {
          group.remove(b.mesh);
          group.remove(b.trail);
          return false;
        }
        b.mesh.position.copy(b.curve.getPoint(Math.min(1, t)));
        (b.trail.material as THREE.LineBasicMaterial).opacity = 0.5 * (1 - t);
        return true;
      });

      composer.render();
    }
    tick();

    function handleResize() {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
      composer.setSize(container.clientWidth, container.clientHeight);
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    // Drag/touch-to-orbit — pointer events cover both mouse and touch, so
    // this works on mobile per the "Responsive / watch on phone" spec too.
    let isDragging = false;
    let lastX = 0, lastY = 0;
    let rotY = 0, rotX = 0;
    function onDown(e: PointerEvent) { isDragging = true; lastX = e.clientX; lastY = e.clientY; }
    function onUp() { isDragging = false; }
    function onMove(e: PointerEvent) {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      rotY += dx * 0.005;
      rotX = Math.max(-1, Math.min(1, rotX + dy * 0.005));
      group.rotation.y = rotY;
      group.rotation.x = rotX;
    }
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
