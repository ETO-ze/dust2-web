/**
 * Build the material-only variant before GLTFLoader sees the document. Cutouts
 * (fences, leaves and glass) keep their original alpha so changing graphics
 * cannot turn a fence into an opaque wall or expose silhouettes behind cover.
 */
const mapImage = /(?:^|\/)assets\/(?:map-cs2|map-mobile)\/.*\.(?:webp|png|jpe?g|ktx2)$/i;
const mapSky = /(?:^|\/)assets\/sky\//;
const colors = {
  plaster: [0.67, 0.69, 0.68],
  floor: [0.40, 0.44, 0.46],
  metal: [0.30, 0.38, 0.42],
  wood: [0.53, 0.40, 0.27],
  foliage: [0.35, 0.45, 0.36],
  objective: [0.80, 0.37, 0.15],
};

function surfaceColor(name) {
  if (/bombsite|bomb_target/.test(name)) return colors.objective;
  if (/wood|crate|plank|pallet|plywood/.test(name)) return colors.wood;
  if (/metal|pipe|chainlink|fence|steel|iron|duct/.test(name)) return colors.metal;
  if (/foliage|leaf|leaves|plant|weed|tree|palm|bush|grass/.test(name)) return colors.foliage;
  if (/floor|road|asphalt|ground|pavement|cobble|sand|gravel/.test(name)) return colors.floor;
  return colors.plaster;
}

function cutoutTexture(material) {
  if (material.alphaMode === 'MASK' || material.alphaMode === 'BLEND') {
    return material.pbrMetallicRoughness?.baseColorTexture;
  }
}

function imageIndices(texture) {
  return [texture?.source, ...Object.values(texture?.extensions || {}).map(ext => ext.source)]
    .filter(Number.isInteger);
}

export function cutoutImagePaths(json, scenePath) {
  const base = new URL(scenePath, 'https://assets.invalid/');
  const paths = new Set();
  for (const material of json.materials || []) {
    const cutout = cutoutTexture(material);
    if (!cutout) continue;
    for (const index of imageIndices(json.textures?.[cutout.index])) {
      const uri = json.images?.[index]?.uri;
      if (uri && !uri.startsWith('data:')) paths.add(new URL(uri, base).pathname.slice(1));
    }
  }
  return paths;
}

export function flatMatchManifest(manifest, keepImages = new Set()) {
  const files = manifest.files.filter(({path}) => !mapSky.test(path) &&
    (!mapImage.test(path) || keepImages.has(path.replace(/^\//, ''))));
  return {...manifest, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)};
}

export function flattenMapDocument(json, {authoredColors = false} = {}) {
  const textures = [], images = [], materials = [];
  const textureIndices = new Map(), imageMap = new Map(), materialsByKey = new Map();
  const remapImage = (index) => {
    if (!imageMap.has(index)) {
      imageMap.set(index, images.length);
      images.push(json.images[index]);
    }
    return imageMap.get(index);
  };
  const remapTexture = (index) => {
    if (textureIndices.has(index)) return textureIndices.get(index);
    const source = json.textures[index], texture = {...source};
    if (source.source !== undefined) texture.source = remapImage(source.source);
    if (source.extensions) {
      texture.extensions = {};
      for (const [name, ext] of Object.entries(source.extensions)) {
        texture.extensions[name] = Number.isInteger(ext.source) ? {...ext, source: remapImage(ext.source)} : ext;
      }
    }
    const next = textures.length;
    textureIndices.set(index, next);
    textures.push(texture);
    return next;
  };

  const indices = (json.materials || []).map(material => {
    const vmat = material.extras?.vmat;
    const name = (vmat?.Name || material.name || '').toLowerCase();
    const hidden = name.startsWith('materials/tools/') || Boolean(vmat?.IntParams?.F_DEPTH_FEATHER);
    const overlay = /overlay|decal|graffiti|poster/.test(name);
    const factor = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
    const rgb = authoredColors ? factor.slice(0, 3) : surfaceColor(name);
    const pbr = {baseColorFactor: [...rgb, factor[3]], metallicFactor: 0, roughnessFactor: 1};
    const cutout = cutoutTexture(material);
    if (cutout) pbr.baseColorTexture = {...cutout, index: remapTexture(cutout.index)};
    const flat = {pbrMetallicRoughness: pbr, alphaMode: material.alphaMode || 'OPAQUE',
      doubleSided: !!material.doubleSided, extras: {flatHidden: hidden, flatOverlay: overlay}};
    if (authoredColors && material.extras?.performanceFence === true) flat.extras.performanceFence = true;
    if (authoredColors && material.extensions?.KHR_materials_unlit) {
      flat.extensions={KHR_materials_unlit:{}};
      flat.extras.bakedSurface=true;
    }
    if (material.alphaCutoff !== undefined) flat.alphaCutoff = material.alphaCutoff;
    const key = JSON.stringify(flat);
    if (!materialsByKey.has(key)) {
      materialsByKey.set(key, materials.length);
      materials.push(flat);
    }
    return materialsByKey.get(key);
  });

  for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) {
    if (primitive.material !== undefined) primitive.material = indices[primitive.material];
    for (const attribute of Object.keys(primitive.attributes)) {
      if (/^(?:COLOR_|TANGENT)/.test(attribute) && !authoredColors) delete primitive.attributes[attribute];
      if (/^TEXCOORD_/.test(attribute) && !materials[primitive.material]?.pbrMetallicRoughness.baseColorTexture) {
        delete primitive.attributes[attribute];
      }
    }
  }
  Object.assign(json, {textures, images, materials});
  return json;
}
