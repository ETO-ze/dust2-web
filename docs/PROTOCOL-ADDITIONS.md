# Protocol additions (merge into server/PROTOCOL.md)

## Modes

`join.mode` accepts:

- `defuse` (default)
- `deathmatch`
- `utility` — solo utility practice (bots forced to 0)
- `debug` — solo debug / callout paint (bots forced to 0)

Room capacity follows `shared/match-rules.js` `GAME_MODES` (`maxPlayers`, `maxBots`, …).

## Chat + client commands

Client → server:

```json
{"type":"chat","scope":"all","text":"/help"}
```

Server → client (private command replies):

```json
{
  "type": "chatMessage",
  "system": true,
  "text": "...",
  "scope": "all",
  "time": 0,
  "clientCommand": "mode_help",
  "args": "{\"html\":\"...\",\"plain\":\"...\"}"
}
```

Known `clientCommand` values:

| Command | Mode | Effect |
|---------|------|--------|
| `mode_help` | any | Show `/help` HTML |
| `practice_export` | utility | Download throws JSON (`args` = `{ throws }`) |
| `practice_import_pick` | utility | Open file picker (`args` = `{ force }`) |
| `practice_list` | utility | List packs / throws HTML |
| `practice_show` | utility | Teleport + aim for demo (`args` = stand/yaw/pitch/weapon/name) |
| `practice_toast` | utility | HUD toast |
| `region` | debug | Start painting |
| `region_name` | debug | Name + commit (`args` = name) |
| `region_end` | debug | End without rename |
| `region_cancel` | debug | Cancel brush |
| `region_list` | debug | List / delete / remake / rename |
| `region_clear` | debug | `/clear all` for session regions |
| `region_show` | debug | `temp` / `all` / `local` |

Normal (non-command) chat may still be broadcast as today.

## Practice import

Client → server (after file pick):

```json
{
  "type": "practiceImport",
  "throws": [ /* throw records */ ],
  "force": false,
  "packId": "import"
}
```

Server replies with a system `chatMessage` + `clientCommand: "practice_toast"`.

Throw record shape: see `shared/practice-throws.js` (`cloneThrowRecord` / import sanitizers).  
Built-in packs: place `*.json` under `shared/practice-packs/` (scanned on utility room init).

## Callouts HTTP API

- `GET /api/dev/callouts` → current callout document JSON  
- `PUT` or `POST /api/dev/callouts` body: `{ "document": { ... }, "promoteShared": false }`  
  - Writes `.runtime/map-callouts.json`  
  - If `promoteShared: true`, also writes `shared/map-callouts.json`

Used by debug F8 editor and region painter export.

## Snapshot extras (utility)

- `practiceThrowCount`: number of recorded throws in the room  
- Player fields: `practiceDummy`, `practiceHud` (dummy overhead feedback)  
- `noclip` / `fly` when cheats enabled via `/fly`
