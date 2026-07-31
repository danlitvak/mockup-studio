import * as THREE from 'three';
import { getDevice, mockupBounds, screenSize } from '../core/devices.ts';
import { fitCameraDistance, offsetToWorld, visibleSizeAt } from '../core/framing.ts';
import { lightRig } from '../core/lighting.ts';
import { evaluateMotion } from '../core/motion.ts';
import type { Project } from '../core/types.ts';
import { BackgroundLayer } from './background.ts';
import { applyDeviceFinish, buildDevice, type DeviceMesh } from './device.ts';
import { createEnvironmentTexture, createShadowTexture, disposeObject } from './geometry.ts';
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

  private readonly environment: THREE.Texture;

  private device: DeviceMesh | null = null;
  private deviceSignature = '';
  /** Softness the current shadow texture was drawn at. */
  private shadowSoftness = 0.5;
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

    // Something for metals to reflect. A metallic material with nothing around
    // it renders black, so without this the metalness control would darken the
    // device instead of making it look like metal.
    const source = createEnvironmentTexture();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromEquirectangular(source).texture;
    pmrem.dispose();
    source.dispose();
    this.scene.environment = this.environment;
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

    // Only things that change the meshes belong here. Finish and glare are
    // applied to the materials below without a rebuild.
    const signature = `${project.scene.device}|${project.scene.deviceColor}|${project.scene.screenCutout}`;
    if (signature !== this.deviceSignature) {
      this.rebuildDevice();
      this.deviceSignature = signature;
    }

    const spec = getDevice(project.scene.device);
    const screen = screenSize(spec);
    this.screenSurface.setLayout(screen.width / screen.height, project.scene.screenFit);

    // Finish is a material change, not a geometry one, so it is applied to the
    // existing meshes rather than triggering a rebuild.
    if (this.device) {
      applyDeviceFinish(
        this.device,
        project.scene.bodyMetalness,
        project.scene.bodyRoughness,
        project.scene.reflectionIntensity,
      );
      if (this.device.glass) {
        this.device.glass.material.opacity = project.scene.screenGlare;
        this.device.glass.visible = project.scene.screenGlare > 0;
      }
    }

    const rig = lightRig(project.scene);
    this.lights.hemi.intensity = rig.intensities.ambient;
    this.lights.key.intensity = rig.intensities.key;
    this.lights.fill.intensity = rig.intensities.fill;
    this.lights.rim.intensity = rig.intensities.rim;
    this.lights.key.position.set(rig.key.x, rig.key.y, rig.key.z);
    this.lights.fill.position.set(rig.fill.x, rig.fill.y, rig.fill.z);
    this.lights.rim.position.set(rig.rim.x, rig.rim.y, rig.rim.z);
    this.lights.key.color.set(rig.keyColor);
    this.lights.fill.color.set(rig.fillColor);

    this.shadow.visible = project.scene.shadow;
    // Straight through, rather than scaled down: the old damping meant the
    // strongest shadow available was still a suggestion.
    this.shadow.material.opacity = project.scene.shadowStrength;
    this.refreshShadowTexture(project.scene.shadowSoftness);

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
      // A soft shadow spreads well past the device; a hard one sits close under
      // it. Scaling with softness is what separates the two — at a fixed size
      // the hard setting just looks like a darker smudge of the same shape.
      const softness = project.scene.shadowSoftness;
      // Comfortably wider than the device, so the dark part of the blob reaches
      // past the silhouette that is hiding its middle.
      const spread = 1.5 + 1 * softness;
      this.shadow.position.set(
        this.pivot.position.x,
        // Dropped below the device rather than centred on it, so the shadow
        // pools underneath the way a real one would.
        this.pivot.position.y - bounds.height * (0.17 + 0.05 * softness) * transform.scale,
        this.pivot.position.z - 0.55,
      );
      this.shadow.scale.set(
        bounds.width * spread * transform.scale,
        bounds.height * spread * 0.78 * transform.scale,
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
    this.environment.dispose();
    this.backgroundLayer.dispose();
    this.screenSurface.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Regenerate the shadow blob when its softness changes.
   *
   * Quantised, and compared against the last value used, because `setProject`
   * runs every frame and redrawing a canvas texture per frame while a slider is
   * being dragged is real work for no visible gain.
   */
  private refreshShadowTexture(softness: number): void {
    const quantised = Math.round(Math.min(1, Math.max(0, softness)) * 20) / 20;
    if (quantised === this.shadowSoftness) return;
    this.shadowSoftness = quantised;
    this.shadow.material.map?.dispose();
    this.shadow.material.map = createShadowTexture(quantised);
    this.shadow.material.needsUpdate = true;
  }

  private rebuildDevice(): void {
    const project = this.project;
    if (!project) return;

    if (this.device) {
      this.pivot.remove(this.device.group);
      disposeObject(this.device.group);
    }

    const spec = getDevice(project.scene.device);
    this.device = buildDevice(spec, project.scene);
    // Attached to each material rather than left to `scene.environment` alone.
    // The scene-level environment lights the body, but `envMapIntensity` only
    // takes effect on a material that owns an `envMap`, so without this the
    // reflection control was measurably inert — setting it to 0 or 2 produced
    // byte-identical frames.
    for (const material of this.device.bodyMaterials) {
      material.envMap = this.environment;
      material.needsUpdate = true;
    }
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
