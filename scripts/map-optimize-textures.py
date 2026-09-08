"""Package S2V glTF for the browser while preserving original UV/material links.

Source exports are left intact. WebP changes compression/resolution, never content.
Run before optional gltf-transform meshopt compression.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import shutil
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--max-size", type=int, default=1024)
    parser.add_argument("--aux-size", type=int, default=512)
    args = parser.parse_args()
    src = args.input.resolve()
    dst = args.output.resolve()
    dst.mkdir(parents=True, exist_ok=True)
    texture_dir = dst / "textures"
    texture_dir.mkdir(exist_ok=True)
    gltf = json.loads(src.read_text(encoding="utf-8-sig"))
    # S2V exports editor-only sky/clip/light-blocking surfaces as renderable
    # meshes. CS2 does not draw these tools materials in the playable view.
    tool_materials = {i for i, material in enumerate(gltf.get("materials", []))
                      if material.get("extras", {}).get("vmat", {}).get("Name", "").replace("\\", "/").startswith("materials/tools/")}
    removed_primitives = 0
    empty_meshes = set()
    for index, mesh in enumerate(gltf.get("meshes", [])):
        old = mesh.get("primitives", [])
        mesh["primitives"] = [p for p in old if p.get("material") not in tool_materials]
        removed_primitives += len(old) - len(mesh["primitives"])
        if not mesh["primitives"]:
            empty_meshes.add(index)
    for node in gltf.get("nodes", []):
        if node.get("mesh") in empty_meshes:
            del node["mesh"]
    mesh_remap = {}
    meshes = []
    for index, mesh in enumerate(gltf.get("meshes", [])):
        if index not in empty_meshes:
            mesh_remap[index] = len(meshes)
            meshes.append(mesh)
    gltf["meshes"] = meshes
    for node in gltf.get("nodes", []):
        if "mesh" in node:
            node["mesh"] = mesh_remap[node["mesh"]]
    print(f"Omitted {removed_primitives} editor-only tool primitives", flush=True)
    images = gltf.get("images", [])
    srgb_images = set()
    for material in gltf.get("materials", []):
        for slot in [material.get("pbrMetallicRoughness", {}).get("baseColorTexture"), material.get("emissiveTexture")]:
            if slot:
                texture = gltf["textures"][slot["index"]]
                if "source" in texture:
                    srgb_images.add(texture["source"])

    def convert(pair):
        index, entry = pair
        source = (src.parent / entry["uri"]).resolve()
        if not source.is_relative_to(src.parent):
            raise ValueError(f"Image escapes export directory: {entry['uri']}")
        source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        color_image=index in srgb_images
        limit = args.max_size if color_image else args.aux_size
        if color_image and any(word in source.name.lower() for word in ("sign", "poster", "graffiti")):
            limit=max(limit,2048)
        digest = hashlib.sha256(f"{source_hash}:{color_image}:{limit}:{source.name}".encode()).hexdigest()[:20]
        output = texture_dir / f"{digest}.webp"
        with Image.open(source) as image:
            original = image.size
            alpha = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
            image = image.convert("RGBA" if alpha else "RGB")
            # Existing small images remain unchanged in resolution. Signage
            # textures receive 2K where available, so lettering stays readable.
            image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            if not output.exists():
                image.save(output, "WEBP", quality=92, method=6, lossless=index not in srgb_images, exact=True)
            size = image.size
        return index, {"uri": f"textures/{output.name}", "mimeType": "image/webp", "name": entry.get("name", source.stem)}, {
            "source": entry["uri"], "sourceSha256": source_hash,
            "sourceBytes": source.stat().st_size, "sourceSize": original,
            "output": f"textures/{output.name}", "bytes": output.stat().st_size, "size": size,
            "hasAlpha": alpha, "losslessCompression": index not in srgb_images,
        }

    report = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for index, image, info in pool.map(convert, enumerate(images)):
            gltf["images"][index] = image
            report.append(info)
            if len(report) % 30 == 0 or len(report) == len(images):
                print(f"Textures {len(report)}/{len(images)}", flush=True)
    for texture in gltf.get("textures", []):
        if "source" in texture:
            texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": texture.pop("source")}
    if images:
        for key in ("extensionsUsed", "extensionsRequired"):
            if "EXT_texture_webp" not in gltf.setdefault(key, []):
                gltf[key].append("EXT_texture_webp")
    for index, buffer in enumerate(gltf.get("buffers", [])):
        if buffer.get("uri", "").startswith("data:"):
            raise ValueError("Expected external S2V buffers")
        source = (src.parent / buffer["uri"]).resolve()
        if not source.is_relative_to(src.parent):
            raise ValueError("Buffer escapes export directory")
        name = f"dust2-{index}.bin"
        shutil.copy2(source, dst / name)
        buffer["uri"] = name
    gltf.setdefault("asset", {}).setdefault("extras", {})["browserPackaging"] = {
        "source": "User's installed Counter-Strike 2 de_dust2.vpk, SHA256 51d6bb432b6553bfae6c38219a527c5de2464a2b107080f2b8be7d8427ebb885, extracted with Source 2 Viewer 20.0",
        "textureProcessing": "Original texture content and UV assignments retained; WebP browser compression; albedo at most 1024 px, signage at most 2048 px, normal/ORM maps at most 512 px.",
        "coordinateSystem": "S2V meters, Y up; apply +90 degrees about Y to align with the shared gameplay map.",
    }
    (dst / "dust2.gltf").write_text(json.dumps(gltf, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    summary = {"source": str(src), "images": len(images), "materials": len(gltf.get("materials", [])), "omittedEditorPrimitives": removed_primitives,
               "meshes": len(gltf.get("meshes", [])), "nodes": len(gltf.get("nodes", [])),
               "originalTextureBytes": sum(i["sourceBytes"] for i in report),
               "webTextureBytes": sum(i["bytes"] for i in report),
               "texturePixels": sum(i["size"][0] * i["size"][1] for i in report), "textures": report}
    (dst / "texture-manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "textures"}, indent=2), flush=True)


if __name__ == "__main__":
    main()
