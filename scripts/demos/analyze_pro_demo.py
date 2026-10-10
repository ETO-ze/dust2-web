"""Extract evidence, not executable lineups, from CS2 demos / cs2-demo-format ZIPs.

Raw mode requires demoparser2==0.42.0. ZIP mode uses the standard library.
All coordinates remain Source units. No browser aim angles are generated.
"""
import argparse
import collections
import hashlib
import json
import math
import pathlib
import zipfile


def sha_file(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def analyze_export(path):
    with zipfile.ZipFile(path) as archive:
        def read(name):
            member = archive.getinfo(name)
            if member.file_size > 100_000_000:
                raise ValueError('Oversized replay member')
            return json.loads(archive.read(name))
        manifest, match = read('manifest.json'), read('match.json')
        if manifest['schemaVersion'] != 'cs2-demo-format/3.0':
            raise ValueError('Unsupported replay schema')
        players, rounds, grenades, bombs = [read(n + '.json') for n in ['players', 'rounds', 'grenades', 'bombs']]
    tickrate = manifest['tickrate']
    if not isinstance(tickrate, (int, float)) or not 16 <= tickrate <= 256:
        raise ValueError('Invalid tickrate')
    clusters = []
    for rnd in rounds:
        attacker = 'teamA' if rnd['teamASide'] == 't' else 'teamB'
        events = sorted((g for g in grenades if g['roundNumber'] == rnd['roundNumber'] and
                         players[g['throwerIndex']]['teamKey'] == attacker and
                         g.get('effectTick') is not None and g['throwTick'] >= rnd['freezeEndTick'] and
                         g['effectTick'] <= rnd['endTick']), key=lambda g: g['effectTick'])
        used = set()
        for first in events:
            if first['grenadeId'] in used:
                continue
            window = [g for g in events if first['effectTick'] <= g['effectTick'] <= first['effectTick'] + tickrate * 6]
            # Spatially related utility only; simultaneous throws at A and B are
            # not evidence of one execute. Intent still needs human review.
            center = first.get('effectPosition')
            if not center:
                continue
            window = [g for g in window if g.get('effectPosition') and math.dist(
                [g['effectPosition'][k] for k in ('x', 'y', 'z')],
                [center[k] for k in ('x', 'y', 'z')]) <= 1600]
            kinds = {g['grenade'] for g in window}
            if not {'smoke', 'flashbang'} <= kinds or len({g['throwerIndex'] for g in window}) < 2:
                continue
            used.update(g['grenadeId'] for g in window)
            plant = next((b for b in bombs if b['roundNumber'] == rnd['roundNumber'] and
                          b['type'] == 'planted' and b['tick'] >= first['effectTick']), None)
            clusters.append({'round': rnd['roundNumber'], 'team': match[attacker]['name'],
                'inferredPurpose': 'multi-player smoke/flash window; not proof of execute intent',
                'laterPlantSite': plant.get('site') if plant else None,
                'firstEffectSeconds': round((first['effectTick'] - rnd['freezeEndTick']) / tickrate, 3),
                'effects': [{'player': players[g['throwerIndex']]['name'], 'kind': g['grenade'],
                    'throwTick': g['throwTick'], 'effectTick': g['effectTick'],
                    'releaseToEffectSeconds': round((g['effectTick'] - g['throwTick']) / tickrate, 3),
                    'effectOffsetSeconds': round((g['effectTick'] - first['effectTick']) / tickrate, 3),
                    'effectPositionSourceUnits': g['effectPosition']} for g in window]})
    return {'format': 'parsed-demo-export', 'map': manifest['mapName'], 'match': match,
            'exporter': manifest['exporter'], 'parser': manifest['parser'], 'originalDemo': manifest['demo'],
            'roundCount': len(rounds), 'grenadeCount': len(grenades),
            'grenadeKinds': dict(collections.Counter(g['grenade'] for g in grenades)),
            'cooperationWindows': clusters,
            'limits': ['6-second / 1600-Source-unit clustering infers proximity, not tactical intent.',
                       'No raw demo throw-angle verification for ZIP input.',
                       'Browser map and trajectory validation required before enabling any lineup.']}


def analyze_raw(path):
    from demoparser2 import DemoParser
    parser = DemoParser(str(path))
    events = set(parser.list_game_events())
    if 'grenade_thrown' not in events:
        raise ValueError('This demo has no release events; do not substitute detonation player positions')
    releases = parser.parse_event('grenade_thrown', player=['X', 'Y', 'Z', 'pitch', 'yaw', 'team_name'],
                                  other=['total_rounds_played']).to_dict('records')
    # Round trip through pandas JSON normalizes missing values without emitting NaN.
    releases = json.loads(__import__('pandas').DataFrame(releases).to_json(orient='records'))
    return {'format': 'raw-CS2-demo', 'header': parser.parse_header(), 'releaseCount': len(releases),
            'releases': releases, 'limits': ['Partial demos may include warmup/knife rounds.',
                'Release positions/angles sampled at grenade_thrown; no detonation-position substitution.',
                'Source angles/units must not be used directly in browser physics.']}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('input', type=pathlib.Path)
    args.add_argument('--source', required=True, help='Public source URL recorded as provenance')
    args.add_argument('--output', type=pathlib.Path, required=True)
    opts = args.parse_args()
    data = analyze_export(opts.input) if opts.input.suffix == '.zip' else analyze_raw(opts.input)
    data.update({'inputSha256': sha_file(opts.input), 'sourceURL': opts.source, 'runtimeLineupsEnabled': False})
    opts.output.parent.mkdir(parents=True, exist_ok=True)
    opts.output.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({k: data.get(k) for k in ['format', 'map', 'roundCount', 'grenadeCount', 'releaseCount']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
