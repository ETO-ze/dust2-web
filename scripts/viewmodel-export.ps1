$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$cli=Join-Path $root 'tools/source2viewer/Source2Viewer-CLI.exe'
$game='E:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo'
$dest=Join-Path $root 'artifacts/viewmodel'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
if(-not(Test-Path -LiteralPath (Join-Path $dest 'arms.glb'))){
 & $cli -i (Join-Path $game 'pak01_dir.vpk') -f 'weapons/models/shared/arms/weapon_arms.vmdl_c' -o (Join-Path $dest 'arms.glb') -d --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt --gltf_export_extras --gltf_export_animations --game (Join-Path $game 'gameinfo.gi') *> (Join-Path $dest 'arms-export.log')
 if($LASTEXITCODE -ne 0){throw 'Arm export failed'}
}
$sets=@{
 ak47=@('rifle/rifle_ak','draw_ak','idle_ak','reload_ak','shoot1_ak','lookat01_ak');
 m4a1=@('rifle/_default_rifle','draw_rifle','idle_rifle','reload_rifle','shoot1_rifle','lookat01_rifle');
 awp=@('rifle/rifle_awp','draw_awp','idle_awp','reload_awp','shoot1_awp','lookat01_awp');
 pistol=@('pistol/pistol_glock18','draw_glock','idle_glock','reload_glock','shoot1_glock','lookat01_glock');
 usp=@('pistol/_default_pistol','draw_silenced_pistol','idle_pistol','reload_pistol','shoot1_pistol','lookat01_pistol');
 knife=@('knife/knife_karambit','draw_karambit','idle1_karambit','light_miss1_karambit','light_miss2_karambit','heavy_miss1_karambit','lookat01_karambit');
}
foreach($id in $sets.Keys){
 $items=$sets[$id]
 for($i=1;$i -lt $items.Length;$i++){
  $name=$items[$i];$output=Join-Path $dest "$id-$name.glb"
  if(Test-Path -LiteralPath $output){continue}
  & $cli -i (Join-Path $game 'pak01_dir.vpk') -f "animation/anims/viewmodel/$($items[0])/$name.vnmclip_c" -o $output -d --gltf_export_format glb --gltf_export_animations --game (Join-Path $game 'gameinfo.gi') *> (Join-Path $dest "$id-$name.log")
  if($LASTEXITCODE -ne 0){throw "Export failed: $id $name"}
  Write-Output "$id $name $((Get-Item -LiteralPath $output).Length)"
 }
}
