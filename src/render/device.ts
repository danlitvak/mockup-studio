import * as THREE from 'three';
import {
  bodySize,
  screenCenterOffsetY,
  screenSize,
  type DeviceSpec,
} from '../core/devices.ts';
import { roundedBoxGeometry, roundedPlaneGeometry, roundedRectShape } from './geometry.ts';

export interface DeviceMesh {
  group: THREE.Group;
  /** The lit display surface — its material carries the media texture. */
  screen: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
}

const TRAFFIC_LIGHTS = [0xff5f57, 0xfebc2e, 0x28c840];

/** Slightly darken a colour, for the parts of the body that face away. */
function shade(hex: string, factor: number): THREE.Color {
  const color = new THREE.Color(hex);
  color.multiplyScalar(factor);
  return color;
}

/**
 * Assemble a device from its spec. Everything is generated at runtime rather
 * than loaded from a model file, which keeps the app fully offline and lets a
 * device's proportions be a data change rather than an asset swap.
 */
export function buildDevice(spec: DeviceSpec, deviceColor: string): DeviceMesh {
  const group = new THREE.Group();
  const body = bodySize(spec);
  const screenDim = screenSize(spec);
  const screenY = screenCenterOffsetY(spec);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(deviceColor),
    metalness: 0.55,
    roughness: 0.38,
  });

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

  if (spec.hasNotch) {
    const notchWidth = screenDim.width * 0.3;
    const notchHeight = 0.052;
    const notch = new THREE.Mesh(
      roundedPlaneGeometry(notchWidth, notchHeight, notchHeight / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
    );
    notch.position.set(
      0,
      screenY + screenDim.height / 2 - notchHeight / 2 - 0.018,
      surfaceZ + 0.001,
    );
    group.add(notch);
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

  if (spec.hasBase) {
    const baseWidth = body.width * 1.12;
    const baseDepth = body.height * 0.62;
    const baseThickness = 0.055;
    const baseMesh = new THREE.Mesh(
      roundedBoxGeometry(baseWidth, baseDepth, baseThickness, 0.03),
      new THREE.MeshStandardMaterial({
        color: shade(deviceColor, 0.88),
        metalness: 0.6,
        roughness: 0.42,
      }),
    );
    // Lay the slab flat and run it forward from the foot of the screen.
    baseMesh.rotation.x = -Math.PI / 2;
    baseMesh.position.set(0, -body.height / 2 - baseThickness / 2, baseDepth / 2 - 0.02);
    group.add(baseMesh);

    // A lip where the lid meets the base, so the hinge does not float.
    const hinge = new THREE.Mesh(
      new THREE.BoxGeometry(body.width * 0.995, 0.035, spec.bodyDepth * 1.1),
      bodyMaterial,
    );
    hinge.position.set(0, -body.height / 2 - 0.012, 0);
    group.add(hinge);
  }

  return { group, screen: screen as DeviceMesh['screen'] };
}

/**
 * Outline used for the device's drop shadow — matches the silhouette so the
 * shadow of a phone does not look like the shadow of a laptop.
 */
export function deviceSilhouette(spec: DeviceSpec): THREE.Shape {
  const body = bodySize(spec);
  return roundedRectShape(body.width, body.height, spec.cornerRadius);
}
