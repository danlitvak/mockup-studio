import * as THREE from 'three';

/** A centred rounded rectangle, used for every device body and screen. */
export function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/**
 * A rounded slab centred on the origin, with bevelled front and back edges so
 * it catches light like a real device rather than reading as a flat card.
 */
export function roundedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  radius: number,
): THREE.ExtrudeGeometry {
  const bevel = Math.min(depth * 0.32, radius * 0.5, 0.02);
  const shape = roundedRectShape(width - bevel * 2, height - bevel * 2, Math.max(0, radius - bevel));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  // ExtrudeGeometry runs from z = 0 forwards; recentre it on the origin.
  geometry.translate(0, 0, -depth / 2 + bevel);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A rounded slab that is thinner along one edge than along the other — a
 * laptop base rather than a uniform slab.
 *
 * The rake runs along y: the full `depth` at +y, `frontDepth` at -y. All of it
 * comes out of the -z side, so the +z face stays flat; that is the face a
 * keyboard and a trackpad have to sit on.
 */
export function taperedBoxGeometry(
  width: number,
  height: number,
  depth: number,
  frontDepth: number,
  radius: number,
): THREE.ExtrudeGeometry {
  const geometry = roundedBoxGeometry(width, height, depth, radius);
  const position = geometry.getAttribute('position');
  const top = depth / 2;
  const thinnest = depth <= 0 ? 1 : Math.min(1, Math.max(0, frontDepth / depth));
  for (let i = 0; i < position.count; i += 1) {
    // 0 along the thin edge, 1 along the full-thickness one.
    const t = Math.min(1, Math.max(0, position.getY(i) / height + 0.5));
    const scale = thinnest + (1 - thinnest) * t;
    position.setZ(i, top - (top - position.getZ(i)) * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Key tops for a laptop deck, as one flat geometry in the XY plane, laid out on
 * an even `columns` × `rows` grid with `gap` between neighbours.
 *
 * One geometry rather than a mesh per key keeps the draw call count and the
 * disposal bookkeeping trivial. The keys are plain quads, and the grid is even
 * where a real keyboard has a short function row and a spacebar: the deck is
 * seen almost edge-on, so a key is a few pixels tall and none of that survives.
 */
export function keyGridGeometry(
  width: number,
  height: number,
  columns: number,
  rows: number,
  gap: number,
): THREE.BufferGeometry {
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const keyWidth = Math.max(cellWidth - gap, cellWidth * 0.25);
  const keyHeight = Math.max(cellHeight - gap, cellHeight * 0.25);
  const positions = new Float32Array(columns * rows * 18);
  let offset = 0;
  const corner = (x: number, y: number): void => {
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = 0;
    offset += 3;
  };

  for (let row = 0; row < rows; row += 1) {
    const centerY = height / 2 - (row + 0.5) * cellHeight;
    for (let column = 0; column < columns; column += 1) {
      const centerX = -width / 2 + (column + 0.5) * cellWidth;
      const left = centerX - keyWidth / 2;
      const right = centerX + keyWidth / 2;
      const bottom = centerY - keyHeight / 2;
      const top = centerY + keyHeight / 2;
      // Wound anticlockwise, so the quads face +z like every other flat piece.
      corner(left, bottom);
      corner(right, bottom);
      corner(right, top);
      corner(left, bottom);
      corner(right, top);
      corner(left, top);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flat rounded rectangle with UVs normalised to 0..1.
 *
 * `ShapeGeometry` derives UVs from raw shape coordinates, which would put them
 * in scene units and misplace the screen texture, so they are rebuilt here.
 */
export function roundedPlaneGeometry(
  width: number,
  height: number,
  radius: number,
): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(roundedRectShape(width, height, radius), 24);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) {
    uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / height + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * A radial blob used as a contact shadow behind the device.
 *
 * `softness` runs 0 to 1. At 0 the blob holds full opacity most of the way out
 * before falling off quickly, which reads as a tight shadow cast onto a surface
 * just behind the device; at 1 it fades from the middle, which reads as a wide
 * ambient one. Doing this in the texture rather than only by scaling the mesh is
 * what makes a hard shadow actually look hard — a stretched soft gradient just
 * looks like a bigger smudge.
 */
export function createShadowTexture(softness = 0.5): THREE.CanvasTexture {
  const size = 256;
  const s = Math.min(1, Math.max(0, softness));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // The core has to reach past the device's own silhouette. The device sits in
    // front of the middle of this blob and hides it, so a core that stops early
    // puts every dark pixel exactly where nobody can see it — which is what made
    // the strongest setting still look like almost nothing.
    const core = 0.68 - 0.28 * s;
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(core, 'rgba(0,0,0,0.95)');
    gradient.addColorStop(core + (1 - core) * 0.38, `rgba(0,0,0,${(0.5 - 0.12 * s).toFixed(3)})`);
    gradient.addColorStop(core + (1 - core) * 0.72, 'rgba(0,0,0,0.16)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A studio-like surround for metals to reflect.
 *
 * Without one, a metallic material reflects an environment that is not there and
 * comes out black — so turning the metalness up, which should make a device look
 * more like metal, instead made it disappear. This is an equirectangular
 * gradient: bright overhead, mid at the horizon, dark below, with one soft
 * highlight standing in for a key light source.
 */
export function createEnvironmentTexture(): THREE.CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#ffffff');
    sky.addColorStop(0.4, '#c8ced8');
    sky.addColorStop(0.52, '#6d7480');
    sky.addColorStop(0.78, '#2b2f36');
    sky.addColorStop(1, '#15171b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // A broad soft light above and to one side, so a polished body picks up a
    // highlight that moves as it turns rather than reading as flat grey.
    const glow = ctx.createRadialGradient(
      width * 0.32,
      height * 0.22,
      0,
      width * 0.32,
      height * 0.22,
      height * 0.5,
    );
    glow.addColorStop(0, 'rgba(255,255,255,0.95)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A diagonal sheen laid over the screen, standing in for a reflection in glass.
 *
 * Drawn as its own additive layer rather than by giving the screen a reflective
 * material: the screen is deliberately unlit so the user's media comes out the
 * colour they gave it, and a lit material would tint every export.
 */
export function createGlassTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    // A broad band running corner to corner, brightest along its own axis.
    const gradient = ctx.createLinearGradient(0, height, width, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.42, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.58, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(0.92, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Free a geometry/material pair without leaving GPU memory behind. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}
