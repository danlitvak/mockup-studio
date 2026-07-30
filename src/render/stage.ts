import * as THREE from 'three';
import { getDevice, mockupBounds, screenSize } from '../core/devices.ts';
import { fitCameraDistance, offsetToWorld, visibleSizeAt } from '../core/framing.ts';
import { evaluateMotion } from '../core/motion.ts';
import type { Project } from '../core/types.ts';
import { BackgroundLayer } from './background.ts';
import { buildDevice, type DeviceMesh } from './device.ts';
import { createShadowTexture, disposeObject } from './geometry.ts';
import { ScreenSurface, type MediaSource } from './screen.ts';

const FOV = 32;
/** Headroom around the device so rotation and float never clip the frame. */
const FIT_MARGIN = 1.32;

/**
 * Owns the WebGL scene.
 *
 * `renderFrame(t)` is a pure function of `t` and the current project: the
 * preview loop and the export loop both call it, which is what guarantees the
 * exported video matches what the user saw.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pivot: THREE.Group;
  private readonly backgroundLayer: BackgroundLayer;
  private readonly screenSurface: ScreenSurface;
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly lights: {
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  };

  private device: DeviceMesh | null = null;
  private deviceSignature = '';
  private project: Project | null = null;
  private frameAspect = 16 / 9;
  private cameraDistance = 8;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // Frames are captured after render during export, so the buffer has to
      // survive past the draw call.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, this.frameAspect, 0.1, 200);
    this.camera.position.set(0, 0, this.cameraDistance);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.backgroundLayer = new BackgroundLayer();
    this.screenSurface = new ScreenSurface();

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: createShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
        toneMapped: false,
      }),
    );
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);

    this.lights = {
      hemi: new THREE.HemisphereLight(0xffffff, 0x30343d, 1.1),
      key: new THREE.DirectionalLight(0xffffff, 2.1),
      fill: new THREE.DirectionalLight(0xdbe6ff, 0.75),
      rim: new THREE.DirectionalLight(0xffffff, 1.1),
    };
    this.lights.key.position.set(3, 4, 6);
    this.lights.fill.position.set(-5, -1, 3);
    this.lights.rim.position.set(-1, 2, -5);
    this.scene.add(this.lights.hemi, this.lights.key, this.lights.fill, this.lights.rim);
  }

  setSize(width: number, height: number, pixelRatio = 1): void {
    if (this.disposed) return;
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    this.frameAspect = w / h;
    this.camera.aspect = this.frameAspect;
    this.camera.updateProjectionMatrix();
    this.reframe();
    this.refreshBackground();
  }

  /** Pixel size of the drawing buffer — what the encoder will actually receive. */
  get bufferSize(): { width: number; height: number } {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  setProject(project: Project): void {
    if (this.disposed) return;
    this.project = project;

    const signature = `${project.scene.device}|${project.scene.deviceColor}`;
    if (signature !== this.deviceSignature) {
      this.rebuildDevice();
      this.deviceSignature = signature;
    }

    const spec = getDevice(project.scene.device);
    const screen = screenSize(spec);
    this.screenSurface.setLayout(screen.width / screen.height, project.scene.screenFit);

    const intensity = project.scene.lightIntensity;
    this.lights.hemi.intensity = 1.1 * intensity;
    this.lights.key.intensity = 2.1 * intensity;
    this.lights.fill.intensity = 0.75 * intensity;
    this.lights.rim.intensity = 1.1 * intensity;

    this.shadow.visible = project.scene.shadow;
    this.shadow.material.opacity = project.scene.shadowStrength * 0.85;

    this.reframe();
    this.refreshBackground();
  }

  setMedia(source: MediaSource | null): void {
    this.screenSurface.setMedia(source);
  }

  /** Force the screen texture to re-read its source, e.g. after a video seek. */
  invalidateScreen(): void {
    this.screenSurface.markDirty();
  }

  /**
   * Draw one frame at normalised time `t` (0..1). Synchronous, so the caller
   * can capture the canvas immediately afterwards.
   */
  renderFrame(t: number): void {
    if (this.disposed) return;
    const project = this.project;
    if (!project) return;

    this.screenSurface.update();

    const spec = getDevice(project.scene.device);
    const transform = evaluateMotion(project.motion, project.scene, t);
    const visible = visibleSizeAt(this.cameraDistance, this.frameAspect, FOV);
    const offset = offsetToWorld(project.scene.offsetX, project.scene.offsetY, visible);

    this.pivot.position.set(
      transform.position.x + offset.x,
      transform.position.y + offset.y,
      transform.position.z,
    );
    this.pivot.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    this.pivot.scale.setScalar(transform.scale);

    if (project.scene.shadow) {
      const bounds = mockupBounds(spec);
      this.shadow.position.set(
        this.pivot.position.x,
        this.pivot.position.y - bounds.height * 0.08 * transform.scale,
        this.pivot.position.z - 0.55,
      );
      this.shadow.scale.set(
        bounds.width * 1.75 * transform.scale,
        bounds.height * 1.5 * transform.scale,
        1,
      );
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.device) disposeObject(this.device.group);
    this.shadow.geometry.dispose();
    this.shadow.material.map?.dispose();
    this.shadow.material.dispose();
    this.backgroundLayer.dispose();
    this.screenSurface.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------------- */

  private rebuildDevice(): void {
    const project = this.project;
    if (!project) return;

    if (this.device) {
      this.pivot.remove(this.device.group);
      disposeObject(this.device.group);
    }

    const spec = getDevice(project.scene.device);
    this.device = buildDevice(spec, project.scene.deviceColor);
    this.device.screen.material.map = this.screenSurface.texture;
    this.device.screen.material.color.set(0xffffff);
    this.device.screen.material.needsUpdate = true;
    this.pivot.add(this.device.group);
    this.screenSurface.markDirty();
  }

  /** Pull the camera back far enough that the whole mockup is in frame. */
  private reframe(): void {
    const project = this.project;
    if (!project) return;
    const bounds = mockupBounds(getDevice(project.scene.device));
    this.cameraDistance = fitCameraDistance(bounds, this.frameAspect, FOV, FIT_MARGIN);
    this.camera.position.set(0, 0, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);
  }

  private refreshBackground(): void {
    const project = this.project;
    if (!project) return;
    const texture = this.backgroundLayer.update(project.scene.background, this.frameAspect);
    this.scene.background = texture;
    this.renderer.setClearAlpha(project.scene.background.kind === 'transparent' ? 0 : 1);
  }
}
