import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BearState } from "./animationStates";
import type { BearMood } from "./behaviorController";

interface GLBCharacterProps {
  modelSrc: string;
  state: BearState;
  mood: BearMood;
  facing: 1 | -1;
  width: number;
  height: number;
  onLoadError: () => void;
}

interface CharacterRig {
  vrm?: VRM;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  activeAction?: THREE.AnimationAction;
  activeClipKey: string;
  bones: {
    head?: THREE.Object3D;
    neck?: THREE.Object3D;
    leftEye?: THREE.Object3D;
    rightEye?: THREE.Object3D;
    leftHand?: THREE.Object3D;
    rightHand?: THREE.Object3D;
    leftArm?: THREE.Object3D;
    rightArm?: THREE.Object3D;
  };
  restRotations: Map<THREE.Object3D, THREE.Euler>;
  morphs: Array<{
    dictionary: Record<string, number>;
    influences: number[];
  }>;
}

const moodGlow: Record<BearMood, THREE.ColorRepresentation> = {
  calm: "#9fdcff",
  curious: "#7cf0ff",
  sleepy: "#b6a6ff",
  excited: "#ffd36a",
  focused: "#72b7ff",
};

export default function GLBCharacter({ modelSrc, state, mood, facing, width, height, onLoadError }: GLBCharacterProps) {
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
    const aspect = width / height;
    let left, right, top, bottom;
    if (aspect < 1) {
      // Portrait side-panel views need enough vertical room to keep the full character visible.
      const zoom = 1.18;
      left = -zoom;
      right = zoom;
      top = zoom / aspect;
      bottom = -zoom / aspect;
    } else {
      const zoom = 1.68;
      left = -zoom * aspect;
      right = zoom * aspect;
      top = zoom;
      bottom = -zoom;
    }
    const camera = new THREE.OrthographicCamera(left, right, top, bottom, 0.1, 100);
    camera.position.set(0, 0.05, 5);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
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
    loader.register((parser) => new VRMLoaderPlugin(parser));
    let disposed = false;
    let animationFrame = 0;

    loader.load(
      modelSrc,
      (gltf) => {
        if (disposed) return;

        const vrm = gltf.userData.vrm as VRM | undefined;
        const model = vrm?.scene ?? gltf.scene;
        if (vrm) {
          VRMUtils.removeUnnecessaryVertices(model);
          VRMUtils.removeUnnecessaryJoints(model);
          VRMUtils.rotateVRM0(vrm);
        }
        prepareModel(model, gltf.animations, vrm);
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
    let lastFrameAt = performance.now();
    function render() {
      const now = performance.now();
      const elapsed = (now - startedAt) / 1000;
      const delta = Math.min(0.05, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      const model = modelRef.current;

      if (model) {
        animateModel(model, elapsed, delta, pointerRef.current, stateRef.current, moodRef.current, facingRef.current);
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
  }, [modelSrc, width, height]);

  return <div className="bwithu-glb-character" ref={mountRef} style={{ width, height }} aria-hidden="true" />;
}

function prepareModel(model: THREE.Group, clips: THREE.AnimationClip[], vrm?: VRM) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  model.position.sub(center);
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const baseScale = 1.62 / maxDimension;
  model.scale.setScalar(baseScale);
  model.userData.baseScale = baseScale;
  model.userData.characterRig = buildCharacterRig(model, clips, vrm);
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

function buildCharacterRig(model: THREE.Group, clips: THREE.AnimationClip[], vrm?: VRM): CharacterRig {
  const mixer = clips.length > 0 ? new THREE.AnimationMixer(model) : null;
  const actions = new Map<string, THREE.AnimationAction>();
  const restRotations = new Map<THREE.Object3D, THREE.Euler>();
  const bones: CharacterRig["bones"] = {};
  const morphs: CharacterRig["morphs"] = [];

  const vrmBones = getVrmBones(vrm);
  Object.assign(bones, vrmBones);
  Object.values(vrmBones).forEach((bone) => {
    if (bone) restRotations.set(bone, bone.rotation.clone());
  });

  for (const clip of clips) {
    if (mixer) actions.set(clip.name.toLowerCase(), mixer.clipAction(clip));
  }

  model.traverse((child) => {
    const normalized = child.name.toLowerCase().replace(/[\s._-]/g, "");

    if (child instanceof THREE.Bone) {
      if (!bones.head && normalized.includes("head")) bones.head = child;
      else if (!bones.neck && normalized.includes("neck")) bones.neck = child;
      else if (!bones.leftEye && (normalized.includes("lefteye") || normalized.includes("eyel"))) bones.leftEye = child;
      else if (!bones.rightEye && (normalized.includes("righteye") || normalized.includes("eyer"))) bones.rightEye = child;
      else if (!bones.leftHand && (normalized.includes("lefthand") || normalized.includes("handl"))) bones.leftHand = child;
      else if (!bones.rightHand && (normalized.includes("righthand") || normalized.includes("handr"))) bones.rightHand = child;
      else if (!bones.leftArm && (normalized.includes("leftarm") || normalized.includes("arml"))) bones.leftArm = child;
      else if (!bones.rightArm && (normalized.includes("rightarm") || normalized.includes("armr"))) bones.rightArm = child;
      restRotations.set(child, child.rotation.clone());
    }

    if (child instanceof THREE.Mesh && child.morphTargetDictionary && child.morphTargetInfluences) {
      morphs.push({
        dictionary: child.morphTargetDictionary as Record<string, number>,
        influences: child.morphTargetInfluences,
      });
    }
  });

  return { vrm, mixer, actions, activeClipKey: "", bones, restRotations, morphs };
}

function getVrmBones(vrm?: VRM): CharacterRig["bones"] {
  if (!vrm?.humanoid) return {};
  const humanoid = vrm.humanoid as unknown as {
    getNormalizedBoneNode?: (name: string) => THREE.Object3D | null;
  };
  const getBone = (name: string) => humanoid.getNormalizedBoneNode?.(name) ?? undefined;
  return {
    head: getBone("head"),
    neck: getBone("neck"),
    leftEye: getBone("leftEye"),
    rightEye: getBone("rightEye"),
    leftHand: getBone("leftHand"),
    rightHand: getBone("rightHand"),
    leftArm: getBone("leftUpperArm"),
    rightArm: getBone("rightUpperArm"),
  };
}

function animateModel(
  model: THREE.Group,
  elapsed: number,
  delta: number,
  pointer: { x: number; y: number },
  state: BearState,
  mood: BearMood,
  facing: 1 | -1,
) {
  const rig = model.userData.characterRig as CharacterRig | undefined;
  updateAnimationClip(rig, state);
  rig?.mixer?.update(delta);
  rig?.vrm?.update(delta);

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

  const modelBaseScale = typeof model.userData.baseScale === "number" ? model.userData.baseScale : 1;
  const animatedScale = modelBaseScale * (1 + breath);
  model.scale.x = (facing === 1 ? 1 : -1) * animatedScale * (1 + squash);
  model.scale.y = animatedScale * (1 - squash * 0.55);
  model.scale.z = animatedScale;
  model.position.y = -0.04 + breath * 0.55 + bounce;
  model.rotation.x = -0.16 + attentionPitch + nod;
  model.rotation.y = facing * (0.18 + attentionYaw) + spin;
  model.rotation.z = state === "curious" ? Math.sin(elapsed * 2.1) * 0.075 : tinyPulse;
  animateRig(rig, elapsed, pointer, state, mood);
}

function updateAnimationClip(rig: CharacterRig | undefined, state: BearState) {
  if (!rig?.mixer || rig.actions.size === 0) return;
  const desired = chooseClipKey(rig.actions, state);
  if (!desired || desired === rig.activeClipKey) return;

  const nextAction = rig.actions.get(desired);
  if (!nextAction) return;
  nextAction.reset().fadeIn(0.25).play();
  rig.activeAction?.fadeOut(0.25);
  rig.activeAction = nextAction;
  rig.activeClipKey = desired;
}

function chooseClipKey(actions: Map<string, THREE.AnimationAction>, state: BearState) {
  const keys = [...actions.keys()];
  const groups: Record<string, string[]> = {
    talk: ["talk", "speak", "speaking", "gesture"],
    listen: ["listen", "attentive", "idle"],
    think: ["think", "thinking", "ponder", "idle"],
    searching: ["search", "thinking", "idle"],
    wave: ["wave", "greet", "hello"],
    happy: ["happy", "joy", "celebrate", "wave"],
    sleepy: ["sleep", "tired", "idle"],
    sleep: ["sleep", "tired", "idle"],
    walk: ["walk", "step", "idle"],
    idle: ["idle", "breath", "stand"],
  };
  const candidates = groups[state] ?? groups.idle;
  return candidates.flatMap((candidate) => keys.filter((key) => key.includes(candidate)))[0] ?? keys[0];
}

function animateRig(
  rig: CharacterRig | undefined,
  elapsed: number,
  pointer: { x: number; y: number },
  state: BearState,
  mood: BearMood,
) {
  if (!rig) return;

  const talkAmount = state === "talk" ? 0.45 + Math.max(0, Math.sin(elapsed * 16)) * 0.45 : 0;
  const smileAmount = mood === "excited" || state === "happy" || state === "wave" ? 0.35 : 0.08;
  const blinkAmount = Math.sin(elapsed * 1.7) > 0.985 ? 1 : 0;

  applyBoneOffset(rig, rig.bones.head, pointer.y * -0.08, pointer.x * 0.16, 0);
  applyBoneOffset(rig, rig.bones.neck, pointer.y * -0.04, pointer.x * 0.08, 0);
  applyBoneOffset(rig, rig.bones.leftEye, pointer.y * -0.05, pointer.x * 0.1, 0);
  applyBoneOffset(rig, rig.bones.rightEye, pointer.y * -0.05, pointer.x * 0.1, 0);

  const handWave = state === "talk" || state === "listen" ? Math.sin(elapsed * 3.2) * 0.12 : 0;
  applyBoneOffset(rig, rig.bones.leftHand ?? rig.bones.leftArm, handWave, 0, handWave * 0.4);
  applyBoneOffset(rig, rig.bones.rightHand ?? rig.bones.rightArm, -handWave, 0, -handWave * 0.4);

  for (const morph of rig.morphs) {
    setMorph(morph, ["mouthopen", "jawopen", "aa", "visemeaa", "viseme_a"], talkAmount);
    setMorph(morph, ["smile", "happy", "mouthsmile"], smileAmount);
    setMorph(morph, ["blink", "blinkleft", "blinkright", "eyesclosed"], blinkAmount);
  }

  setVrmExpression(rig.vrm, ["aa", "oh"], talkAmount);
  setVrmExpression(rig.vrm, ["happy", "relaxed"], smileAmount);
  setVrmExpression(rig.vrm, ["blink", "blinkLeft", "blinkRight"], blinkAmount);
}

function applyBoneOffset(rig: CharacterRig, bone: THREE.Object3D | undefined, x: number, y: number, z: number) {
  if (!bone) return;
  const rest = rig.restRotations.get(bone);
  if (!rest) return;
  bone.rotation.set(rest.x + x, rest.y + y, rest.z + z);
}

function setMorph(morph: CharacterRig["morphs"][number], names: string[], value: number) {
  for (const [rawName, index] of Object.entries(morph.dictionary)) {
    const normalized = rawName.toLowerCase().replace(/[\s._-]/g, "");
    if (names.some((name) => normalized.includes(name))) {
      morph.influences[index] = THREE.MathUtils.clamp(value, 0, 1);
    }
  }
}

function setVrmExpression(vrm: VRM | undefined, names: string[], value: number) {
  const expressionManager = vrm?.expressionManager as
    | {
        setValue?: (name: string, value: number) => void;
        update?: () => void;
      }
    | undefined;
  if (!expressionManager?.setValue) return;
  for (const name of names) {
    expressionManager.setValue(name, THREE.MathUtils.clamp(value, 0, 1));
  }
  expressionManager.update?.();
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
