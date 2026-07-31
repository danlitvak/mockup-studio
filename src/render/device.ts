import * as THREE from 'three';
import {
  baseLayout,
  bodySize,
  screenCenterOffsetY,
  screenSize,
  type DeviceSpec,
} from '../core/devices.ts';
import { clamp01 } from '../core/easing.ts';
import type { SceneSettings } from '../core/types.ts';
import {
  createGlassTexture,
  keyGridGeometry,
  roundedBoxGeometry,
  roundedPlaneGeometry,
  roundedRectShape,
  taperedBoxGeometry,
} from './geometry.ts';

export interface DeviceMesh {
  group: THREE.Group;
  /** The lit display surface — its material carries the media texture. */
  screen: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  /**
   * Every material made of the body's substance, so finish can be changed
   * without rebuilding the meshes. Dragging a roughness slider must not
   * reallocate geometry on every frame.
   */
  bodyMaterials: THREE.MeshStandardMaterial[];
  /** The glass sheen over the screen, on devices that have one. */
  glass: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial> | null;
}

const TRAFFIC_LIGHTS = [0xff5f57, 0xfebc2e, 0x28c840];

/** Keyboard grid, and the gap between neighbouring keys as a share of the pitch. */
const KEY_COLUMNS = 14;
const KEY_ROWS = 5;
const KEY_GAP = 0.09;

/**
 * How far the deck's markings float above the deck itself. Enough to stay well
 * clear of each other in the depth buffer, far too little to see from a camera
 * that is nearly in the plane of the deck.
 */
const DECK_LIFT = 0.0006;

/** Slightly darken a colour, for the parts of the body that face away. */
function shade(hex: string, factor: number): THREE.Color {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return color;
}

/**
 * Shift a colour toward whichever of black or white contrasts with it.
 *
 * Scaling the body colour cannot keep a detail legible across the whole range
 * the user can pick: a factor below 1 disappears into a near-black body, and one
 * above 1 clamps out on a near-white one. The keyboard and trackpad have to read
 * on both, so the direction is taken from the body's own luminance instead of
 * being fixed in the factor.
 */
function contrastingShade(hex: string, amount: number): THREE.Color {
  const color = new THREE.Color(hex);
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const target = luminance > 0.5 ? 0 : 1;
  return color.lerp(new THREE.Color(target, target, target), amount);
}

/** The finish the body was designed with, and the middle of the user's range. */
const DEFAULT_FINISH = { metalness: 0.55, roughness: 0.38 };

interface AuthoredFinish {
  metalness: number;
  roughness: number;
}

/** Remember what a part was designed to look like before anyone adjusts it. */
function registerBody(
  materials: THREE.MeshStandardMaterial[],
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  material.userData.authored = {
    metalness: material.metalness,
    roughness: material.roughness,
  } satisfies AuthoredFinish;
  materials.push(material);
  return material;
}

/**
 * Apply the scene's finish to every part of the body.
 *
 * The user gets one metalness and one roughness for the whole device, but the
 * parts are not all the same material — a keyboard well is matte where a
 * trackpad is glossy. Shifting each part relative to what it was authored with,
 * rather than setting them all to the same number, keeps those differences
 * intact across the range.
 */
export function applyDeviceFinish(
  device: DeviceMesh,
  metalness: number,
  roughness: number,
  envIntensity = 1,
): void {
  const metalShift = metalness - DEFAULT_FINISH.metalness;
  const roughShift = roughness - DEFAULT_FINISH.roughness;
  for (const material of device.bodyMaterials) {
    const authored = material.userData.authored as AuthoredFinish | undefined;
    if (!authored) continue;
    material.metalness = clamp01(authored.metalness + metalShift);
    // Never perfectly smooth. A polished metal shows almost nothing but its
    // reflections, and the surround it has to reflect here is a generated
    // gradient rather than a real room — left at zero it reads as a flat cutout.
    material.roughness = Math.min(1, Math.max(0.06, authored.roughness + roughShift));
    // Reflections follow the ambient control, so one slider governs how much of
    // the surround the device picks up rather than it being fixed.
    material.envMapIntensity = Math.max(0, envIntensity);
  }
}

/**
 * Assemble a device from its spec. Everything is generated at runtime rather
 * than loaded from a model file, which keeps the app fully offline and lets a
 * device's proportions be a data change rather than an asset swap.
 */
export function buildDevice(spec: DeviceSpec, scene: SceneSettings): DeviceMesh {
  const deviceColor = scene.deviceColor;
  const group = new THREE.Group();
  const body = bodySize(spec);
  const screenDim = screenSize(spec);
  const screenY = screenCenterOffsetY(spec);
  const bodyMaterials: THREE.MeshStandardMaterial[] = [];

  // Authored at the design baseline, not at the user's setting: the finish is
  // applied as a shift at the end of the build, and it has to shift from what
  // each part was designed to look like.
  const bodyMaterial = registerBody(
    bodyMaterials,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(deviceColor),
      metalness: DEFAULT_FINISH.metalness,
      roughness: DEFAULT_FINISH.roughness,
    }),
  );

  const bodyMesh = new THREE.Mesh(
    roundedBoxGeometry(body.width, body.height, spec.bodyDepth, spec.cornerRadius),
    bodyMaterial,
  );
  group.add(bodyMesh);

  // The screen floats just proud of the body so it never z-fights with it.
  const surfaceZ = spec.bodyDepth / 2 + 0.0015;
  const screenRadius = Math.max(0.004, spec.cornerRadius - spec.bezel);
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: 0x101014,
    toneMapped: false,
  });
  const screen = new THREE.Mesh(
    roundedPlaneGeometry(screenDim.width, screenDim.height, screenRadius),
    screenMaterial,
  );
  screen.position.set(0, screenY, surfaceZ);
  group.add(screen);

  // The glass sheen sits above the media but below the cutout, so a reflection
  // runs across the screen without washing over the island drawn on top of it.
  const glass = new THREE.Mesh(
    roundedPlaneGeometry(screenDim.width, screenDim.height, screenRadius),
    new THREE.MeshBasicMaterial({
      map: createGlassTexture(),
      transparent: true,
      // Additive so the sheen brightens the media rather than greying it, and
      // depthWrite off so it never occludes what is behind it.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: scene.screenGlare,
      toneMapped: false,
    }),
  );
  glass.position.set(0, screenY, surfaceZ + 0.0008);
  glass.visible = scene.screenGlare > 0;
  group.add(glass);

  if (spec.hasNotch && scene.screenCutout !== 'none') {
    // Two shapes, both black and both drawn on the glass rather than cut out of
    // it: a wide notch hanging off the top edge, or a pill floating below it.
    const island = scene.screenCutout === 'island';
    const cutoutWidth = screenDim.width * (island ? 0.3 : 0.52);
    const cutoutHeight = island ? 0.052 : 0.06;
    const gap = island ? 0.018 : 0;
    const radius = island ? cutoutHeight / 2 : cutoutHeight * 0.42;

    const cutout = new THREE.Mesh(
      roundedPlaneGeometry(cutoutWidth, cutoutHeight, radius),
      new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
    );
    cutout.position.set(
      0,
      // A notch sits flush against the top edge of the screen; an island hangs
      // a little below it.
      screenY + screenDim.height / 2 - cutoutHeight / 2 - gap,
      surfaceZ + 0.0016,
    );
    group.add(cutout);
  }

  if (spec.hasChrome) {
    // The chrome strip is the exposed top of the body; only the controls are
    // drawn on top of it.
    const dotRadius = spec.chromeHeight * 0.115;
    const chromeCenterY = body.height / 2 - spec.chromeHeight / 2;
    TRAFFIC_LIGHTS.forEach((color, index) => {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(dotRadius, 24),
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      );
      dot.position.set(
        -body.width / 2 + spec.chromeHeight * 0.42 + index * dotRadius * 3.1,
        chromeCenterY,
        surfaceZ,
      );
      group.add(dot);
    });

    // A dim pill standing in for the address bar.
    const barWidth = body.width * 0.42;
    const barHeight = spec.chromeHeight * 0.42;
    const bar = new THREE.Mesh(
      roundedPlaneGeometry(barWidth, barHeight, barHeight / 2),
      new THREE.MeshBasicMaterial({
        color: shade(deviceColor, 1.9).getHex(),
        toneMapped: false,
      }),
    );
    bar.position.set(0, chromeCenterY, surfaceZ);
    group.add(bar);
  }

  const base = baseLayout(spec);
  if (base) {
    const baseMesh = new THREE.Mesh(
      taperedBoxGeometry(base.width, base.depth, base.thickness, base.frontThickness, base.radius),
      registerBody(
        bodyMaterials,
        new THREE.MeshStandardMaterial({
          color: shade(deviceColor, 0.95),
          metalness: 0.58,
          roughness: 0.4,
        }),
      ),
    );
    // Lay the wedge flat: its thick edge becomes the hinge edge at the back and
    // the face the taper spared becomes the deck.
    baseMesh.rotation.x = -Math.PI / 2;
    baseMesh.position.set(0, base.topY - base.thickness / 2, base.centerZ);
    group.add(baseMesh);

    // The keyboard is a dark well rather than a modelled recess. A real one is
    // shallower than the line that bounds it once the deck is foreshortened, so
    // sinking it would cost vertices and buy nothing.
    const deckY = base.topY + DECK_LIFT;
    const well = new THREE.Mesh(
      roundedPlaneGeometry(base.well.width, base.well.depth, base.radius * 0.5),
      registerBody(
        bodyMaterials,
        new THREE.MeshStandardMaterial({
          color: shade(deviceColor, 0.32),
          metalness: 0.12,
          roughness: 0.88,
        }),
      ),
    );
    well.rotation.x = -Math.PI / 2;
    well.position.set(0, deckY, base.well.centerZ);
    group.add(well);

    // Keycaps stand away from the well rather than relying on finish alone. On
    // the default near-black body a darker key vanishes into the well, and on a
    // silver one a lighter key vanishes into the deck, so the contrast has to
    // pick its own direction.
    const keys = new THREE.Mesh(
      keyGridGeometry(
        base.well.width,
        base.well.depth,
        KEY_COLUMNS,
        KEY_ROWS,
        (base.well.width / KEY_COLUMNS) * KEY_GAP,
      ),
      registerBody(
        bodyMaterials,
        new THREE.MeshStandardMaterial({
          color: contrastingShade(deviceColor, 0.22),
          metalness: 0.1,
          roughness: 0.7,
        }),
      ),
    );
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, deckY + DECK_LIFT, base.well.centerZ);
    group.add(keys);

    const trackpad = new THREE.Mesh(
      roundedPlaneGeometry(base.trackpad.width, base.trackpad.depth, base.radius),
      registerBody(
        bodyMaterials,
        new THREE.MeshStandardMaterial({
          color: contrastingShade(deviceColor, 0.12),
          metalness: 0.4,
          roughness: 0.3,
        }),
      ),
    );
    trackpad.rotation.x = -Math.PI / 2;
    trackpad.position.set(0, deckY, base.trackpad.centerZ);
    group.add(trackpad);

    // A barrel across the foot of the lid, proud of it front and back. The lid
    // sits on this rather than on the deck, which is where the lip comes from.
    const hinge = new THREE.Mesh(
      new THREE.CylinderGeometry(base.hinge.radius, base.hinge.radius, base.hinge.length, 24),
      registerBody(
        bodyMaterials,
        new THREE.MeshStandardMaterial({
          color: shade(deviceColor, 0.7),
          metalness: 0.75,
          roughness: 0.28,
        }),
      ),
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, base.hinge.centerY, 0);
    group.add(hinge);
  }

  const device: DeviceMesh = {
    group,
    screen: screen as DeviceMesh['screen'],
    bodyMaterials,
    glass,
  };
  applyDeviceFinish(device, scene.bodyMetalness, scene.bodyRoughness);
  return device;
}

/**
 * Outline used for the device's drop shadow — matches the silhouette so the
 * shadow of a phone does not look like the shadow of a laptop.
 */
export function deviceSilhouette(spec: DeviceSpec): THREE.Shape {
  const body = bodySize(spec);
  const base = baseLayout(spec);
  if (!base) return roundedRectShape(body.width, body.height, spec.cornerRadius);
  // A laptop's outline is the base: it is the wider of the two, and it is what
  // reaches down to the surface the shadow falls on.
  return roundedRectShape(
    base.width,
    body.height / 2 - base.topY + base.thickness,
    spec.cornerRadius,
  );
}
