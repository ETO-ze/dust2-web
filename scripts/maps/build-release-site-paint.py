"""Identify superseded red floor paint in the public map package using source decal coverage."""
from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path

from site_marking_source import paint_ranges, placed_markings, source_file


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('maps', type=Path)
    parser.add_argument('library', type=Path, help='Source archives grouped by map and source SHA')
    parser.add_argument('extra', type=Path, help='Supplemental source archives')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = {}
    for map_id in ('de_dust2', 'de_mirage', 'de_cache'):
        folder = args.maps / map_id
        meta = json.loads((folder / 'compiled/map.json').read_bytes())
        manifest = json.loads((folder / 'render-manifest.json').read_bytes())
        if manifest['id'] != map_id or manifest['sourceSha256'] != meta['sourceSha256']:
            raise ValueError(f'{map_id}: map and render manifest do not match')
        hashes = {entry['path']: entry['sha256'] for entry in manifest['files']}
        for name in ('map.gltf', 'map.bin'):
            if sha256((folder / 'render' / name).read_bytes()).hexdigest() != hashes[name]:
                raise ValueError(f'{map_id}: mismatched render file {name}')
        source = source_file(args.library, args.extra, map_id, meta['sourceSha256'])
        ranges = paint_ranges(folder, placed_markings(source, map_id, meta['sites']))
        if not ranges:
            raise ValueError(f'{map_id}: no matching source paint triangles')
        output[map_id] = dict(source=meta['sourceSha256'], render=hashes['map.gltf'],
                              geometry=hashes['map.bin'], ranges=ranges)
        print(map_id, sum(sum(values[1::2]) for values in ranges.values()), 'triangles')
    args.output.write_text(json.dumps(output, separators=(',', ':')) + '\n', encoding='utf8')


if __name__ == '__main__':
    main()
