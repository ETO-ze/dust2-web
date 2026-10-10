"""Build auditable team-style summaries from cs2-demo-format/3.0 exports.

No training claim: opening-place occupancy and utility counts are observations,
not inferred enemy knowledge or executable Source 2 throw angles.
"""
import argparse
import collections
import json
import pathlib
import zipfile
import statistics
from analyze_pro_demo import analyze_export, sha_file


def summarize(path, team='Vitality'):
    evidence = analyze_export(path)
    with zipfile.ZipFile(path) as z:
        def read(name):
            member = z.getinfo(name + '.json')
            if member.file_size > 100_000_000:
                raise ValueError('Oversized replay member')
            return json.loads(z.read(name + '.json'))
        players, rounds, replay, grenades = [read(n) for n in ['players', 'rounds', 'replay', 'grenades']]
    teams = [key for key in ['teamA', 'teamB'] if team.lower() in evidence['match'][key]['name'].lower()]
    if len(teams) != 1:
        raise ValueError('Team is absent or ambiguous')
    key = teams[0]
    members = {i: p['name'] for i, p in enumerate(players) if p['teamKey'] == key}
    index = {r['roundNumber']: r for r in rounds}
    counts = {name: {side: {'openingPlaces': collections.Counter(), 'points': collections.defaultdict(list), 'utility': collections.Counter()}
                     for side in ['ct', 't']} for name in members.values()}
    for rnd in replay['rounds']:
        info = index[rnd['roundNumber']]
        side = info[key + 'Side']
        for p in rnd['players']:
            if p['playerIndex'] not in members:
                continue
            counter = counts[members[p['playerIndex']]][side]['openingPlaces']
            coords = {axis: [] for axis in ['x', 'y', 'z']}
            for axis, values in coords.items():
                cumulative = 0
                for delta in p[axis]:
                    cumulative += delta
                    values.append(cumulative * replay['meta']['coordScale'])
            for frame, place in enumerate(p['place']):
                tick = rnd['startTick'] + frame * rnd['tickStep']
                seconds = (tick - info['freezeEndTick']) / evidence['match']['tickrate']
                if 10 <= seconds < 35 and tick <= info['endTick'] and p['hp'][frame] > 0:
                    counter[replay['placeDict'][place]] += 1
                    counts[members[p['playerIndex']]][side]['points'][replay['placeDict'][place]].append(
                        [coords[axis][frame] for axis in ['x', 'y', 'z']])
    for g in grenades:
        if g['throwerIndex'] not in members:
            continue
        rnd = index[g['roundNumber']]
        if rnd['freezeEndTick'] <= g['throwTick'] <= rnd['endTick']:
            counts[members[g['throwerIndex']]][rnd[key + 'Side']]['utility'][g['grenade']] += 1
    result = {}
    for name, sides in counts.items():
        result[name] = {}
        for side, values in sides.items():
            places = values['openingPlaces']
            result[name][side] = {'openingSamples': sum(places.values()),
                'openingPlaces': dict(places.most_common(8)), 'utility': dict(values['utility']),
                'openingPositions': [{'place': place, 'samples': count,
                    'sourcePoint': dict(zip(['x', 'y', 'z'], [round(statistics.median(p[i] for p in values['points'][place]), 2) for i in range(3)]))}
                    for place, count in places.most_common(8)]}
    windows = [w for w in evidence['cooperationWindows'] if team.lower() in w['team'].lower()]
    return {'map': evidence['map'], 'rounds': len(rounds), 'inputSha256': sha_file(path),
            'sourceFile': path.name, 'originalDemo': evidence['originalDemo'], 'players': result,
            'cooperationWindows': len(windows),
            'examples': [{k: w[k] for k in ['round', 'firstEffectSeconds', 'laterPlantSite', 'effects']}
                         for w in windows[:3]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    opts = parser.parse_args()
    evidence = {'schemaVersion': 1, 'team': 'Vitality',
        'source': 'https://github.com/Starfie1d1272/cs2-demo-analysis-kit/tree/main/fixtures/input',
        'matchReference': 'https://www.hltv.org/matches/2389666/furia-vs-vitality-iem-krakw-2026',
        'method': 'Alive opening-place samples 10–35 seconds after freeze; release events during live rounds; 6-second utility proximity windows.',
        'limitations': ['One BO5 series; fixture filenames use export date 2026-02-09, match page is 2026-02-08.',
                       'Positions are NAV place labels, not validated browser stand points.',
                       'Cooperation windows are proximity evidence, not verified tactical intent.',
                       'No exact professional skill, full strategy imitation or trained model is claimed.'],
        'maps': {}}
    for path in opts.inputs:
        item = summarize(path)
        evidence['maps'][item['map']] = item
        print(item['map'], item['rounds'], item['cooperationWindows'])
    opts.output.parent.mkdir(parents=True, exist_ok=True)
    opts.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
