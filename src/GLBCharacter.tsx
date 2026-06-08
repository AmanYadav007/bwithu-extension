import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BearState } from "./animationStates";
import type { BearMood } from "./behaviorController";

interface GLBCharacterProps {
  modelSrc: string;
  state: BearState;
  mood: BearMood;
  facing: 1 | -1;
  size: number;
  onLoadError: () => void;
}

const moodGlow: Record<BearMood, THREE.ColorRepresentation> = {
  calm: "#9fdcff",
  curious: "#7cf0ff",
  sleepy: "#b6a6ff",
  excited: "#ffd36a",
  focused: "#72b7ff",
};

export default function GLBCharacter({ modelSrc, state, mood, facing, size, onLoadError }: GLBCharacterProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const stateRef = useRef(state);
  const moodRef = useRef(mood);
  const facingRef = useRef(facing);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  useEffect(() => {
    facingRef.current = facing;
  }, [facing]);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const mountElement = mount;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.28, 1.28, 1.28, -1.28, 0.1, 100);
    camera.position.set(0, 0.18, 5);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    mountElement.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xffffff, 0x7c5a9f, 2.6);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(2.5, 4, 3);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(moodGlow[moodRef.current], 2.4, 7);
    rimLight.position.set(-1.3, 1.6, 2.5);
    scene.add(rimLight);

    const loader = new GLTFLoader();
    let disposed = false;
    let animationFrame = 0;

    loader.load(
      modelSrc,
      (gltf) => {
        if (disposed) return;

        const model = gltf.scene;
        prepareModel(model);
        modelRef.current = model;
        scene.add(model);
      },
      undefined,
      () => {
        if (!disposed) onLoadErrorRef.current();
      },
    );

    function handlePointerMove(event: PointerEvent) {
      const rect = mountElement.getBoundingClientRect();
      pointerRef.current = {
        x: THREE.MathUtils.clamp((event.clientX - (rect.left + rect.width / 2)) / 220, -1, 1),
        y: THREE.MathUtils.clamp((event.clientY - (rect.top + rect.height / 2)) / 220, -1, 1),
      };
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    const startedAt = performance.now();
    function render() {
      const elapsed = (performance.now() - startedAt) / 1000;
      const model = modelRef.current;

      if (model) {
        animateModel(model, elapsed, pointerRef.current, stateRef.current, moodRef.current, facingRef.current);
        rimLight.color.set(moodGlow[moodRef.current]);
        rimLight.intensity = stateRef.current === "talk" || stateRef.current === "searching" ? 3.3 : 2.1;
      }

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(render);
    }

    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", handlePointerMove);
      mountElement.removeChild(renderer.domElement);
      disposeScene(scene);
      renderer.dispose();
      modelRef.current = null;
    };
  }, [modelSrc, size]);

  return <div className="bwithu-glb-character" ref={mountRef} style={{ width: size, height: size }} aria-hidden="true" />;
}

function prepareModel(model: THREE.Group) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  model.position.sub(center);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  model.scale.setScalar(2.75 / maxDimension);
  model.rotation.set(-0.16, 0.18, 0);

  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.frustumCulled = false;
    child.castShadow = false;
    child.receiveShadow = false;
    if (child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.72;
      child.material.metalness = 0.03;
      child.material.needsUpdate = true;
    }
  });
}

function animateModel(
  model: THREE.Group,
  elapsed: number,
  pointer: { x: number; y: number },
  state: BearState,
  mood: BearMood,
  facing: 1 | -1,
) {
  const breathSpeed = mood === "sleepy" ? 1.2 : mood === "excited" ? 2.25 : 1.65;
  const breath = Math.sin(elapsed * breathSpeed) * 0.018;
  const tinyPulse = Math.sin(elapsed * 3.4) * 0.006;
  const gazeNoiseX = Math.sin(elapsed * 0.5) * Math.cos(elapsed * 0.35) * 0.06;
  const gazeNoiseY = Math.cos(elapsed * 0.45) * Math.sin(elapsed * 0.2) * 0.03;
  const attentionYaw = THREE.MathUtils.clamp(pointer.x * 0.28 + gazeNoiseX, -0.28, 0.28);
  const attentionPitch = THREE.MathUtils.clamp(pointer.y * -0.12 + gazeNoiseY, -0.14, 0.14);

  let squash = 0;
  let bounce = 0;
  let spin = 0;
  let nod = 0;

  if (state === "listen") nod = Math.sin(elapsed * 3.2) * 0.06;
  if (state === "walk") {
    bounce = Math.abs(Math.sin(elapsed * 9)) * 0.08;
    spin = Math.sin(elapsed * 9) * 0.07;
    nod = Math.sin(elapsed * 18) * 0.04;
    squash = Math.sin(elapsed * 9) * 0.035;
  }
  if (state === "think" || state === "searching") {
    spin = Math.sin(elapsed * 3.8) * 0.16;
    bounce = Math.max(0, Math.sin(elapsed * 4.8)) * 0.035;
  }
  if (state === "talk") {
    squash = Math.sin(elapsed * 10) * 0.04 + Math.sin(elapsed * 23) * 0.015;
    bounce = Math.max(0, Math.sin(elapsed * 8.5)) * 0.08 + Math.max(0, Math.sin(elapsed * 17)) * 0.02;
    spin = Math.sin(elapsed * 4.5) * 0.06 + Math.sin(elapsed * 11) * 0.02;
    nod = Math.sin(elapsed * 13) * 0.04;
  }
  if (state === "happy" || state === "wave") {
    bounce = Math.abs(Math.sin(elapsed * 6.4)) * 0.18;
    spin = Math.sin(elapsed * 8.5) * 0.34;
    squash = Math.sin(elapsed * 8.5) * 0.035;
  }
  if (state === "drag") {
    squash = Math.sin(elapsed * 10) * 0.025;
    spin = Math.sin(elapsed * 6) * 0.24;
  }
  if (state === "sleepy" || state === "sleep") {
    nod = -0.13 + Math.sin(elapsed * 1.1) * 0.035;
  }

  const baseScale = 1 + breath;
  model.scale.x = (facing === 1 ? 1 : -1) * baseScale * (1 + squash);
  model.scale.y = baseScale * (1 - squash * 0.55);
  model.scale.z = baseScale;
  model.position.y = -0.04 + breath * 0.55 + bounce;
  model.rotation.x = -0.16 + attentionPitch + nod;
  model.rotation.y = facing * (0.18 + attentionYaw) + spin;
  model.rotation.z = state === "curious" ? Math.sin(elapsed * 2.1) * 0.075 : tinyPulse;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}
