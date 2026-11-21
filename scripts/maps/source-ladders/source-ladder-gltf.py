"""glTF and Source color helpers shared with the original Blender map build."""

import json

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

DTYPE = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4", 5122: "<i2", 5120: "i1"}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read(path):
    return json.loads(path.read_bytes())


def data_view(doc, data, idx):
    a = doc["accessors"][idx]
    view = doc["bufferViews"][a["bufferView"]]
    dtype, width = np.dtype(DTYPE[a["componentType"]]), WIDTH[a["type"]]
    return np.ndarray(
        (a["count"], width),
        dtype,
        data,
        offset=view.get("byteOffset", 0) + a.get("byteOffset", 0),
        strides=(view.get("byteStride", width * dtype.itemsize), dtype.itemsize),
    )


def world_nodes(doc):
    def visit(index, parent):
        node = doc["nodes"][index]
        if "matrix" in node:
            local = np.array(node["matrix"]).reshape(4, 4).T
        else:
            x, y, z, w = node.get("rotation", (0, 0, 0, 1))
            local = np.array(
                Matrix.LocRotScale(
                    Vector(node.get("translation", (0, 0, 0))),
                    Quaternion((w, x, y, z)),
                    Vector(node.get("scale", (1, 1, 1))),
                )
            )
        world = parent @ local
        yield index, node, world
        for child in node.get("children", []):
            yield from visit(child, world)

    for root in doc["scenes"][doc.get("scene", 0)]["nodes"]:
        yield from visit(root, np.eye(4))


def write_model(file, doc, views):
    binary = bytearray()
    for view, chunk in zip(doc["bufferViews"], views):
        binary.extend(bytes((-len(binary)) % 4))
        view["byteOffset"] = len(binary)
        view["byteLength"] = len(chunk)
        binary.extend(chunk)
    binary.extend(bytes((-len(binary)) % 4))
    doc["buffers"][0]["byteLength"] = len(binary)
    (file.parent / "map.bin").write_bytes(binary)
    file.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), "utf8")


def rgb_from_uvs(file, uv):
    image = bpy.data.images.load(str(file.resolve()))
    # glTF v=0 is the first row in the PNG, Blender arrays start at the bottom.
    width, height = image.size
    image.scale(min(256, width), min(256, height))
    width, height = image.size
    pixels = np.empty(width * height * 4, "f4")
    image.pixels.foreach_get(pixels)
    ix = (uv[:, 0] * width).astype("i8") % width
    iy = height - 1 - (uv[:, 1] * height).astype("i8") % height
    color = pixels.reshape(height, width, 4)[iy, ix, :3].copy()
    bpy.data.images.remove(image)
    return color
