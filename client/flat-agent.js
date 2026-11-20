import * as THREE from 'three';

// One untextured instanced draw per actor. Coordinates match the standing and crouched
// game hulls and the fallback weapon grip in PlayerModel.
export function createFlatAgent(team) {
  const group=new THREE.Group(), transform=new THREE.Object3D();
  const blue=team==='CT', cloth=blue?0x6289ac:0xca9d6c, dark=blue?0x344b62:0x665449;
  const parts=[
    [.40,.56,.27, 0,1.14,0,cloth],
    [.32,.29,.28, 0,1.59,0,cloth],
    [.29,.075,.04, 0,1.61,-.15,dark],
    [.39,.21,.31, 0,.84,0,dark],
    [.15,.18,.38, -.235,1.18,-.13,cloth],
    [.15,.18,.38, .235,1.18,-.13,cloth],
    [.17,.72,.2, -.107,.38,0,dark],
    [.17,.72,.2, .107,.38,0,dark],
  ];
  const geometry=new THREE.BoxGeometry(),material=new THREE.MeshLambertMaterial();
  const mesh=new THREE.InstancedMesh(geometry,material,parts.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,.9,0),1.15);
  group.add(mesh);
  function setPart(index,angle=0) {
    const [w,h,d,x,y,z]=parts[index];
    transform.position.set(x,y,z);
    if(index>=6) {transform.position.y+=h*.5*(1-Math.cos(angle));transform.position.z-=h*.5*Math.sin(angle);}
    transform.rotation.x=angle;transform.scale.set(w,h,d);transform.updateMatrix();
    mesh.setMatrixAt(index,transform.matrix);
  }
  parts.forEach((p,i)=>{setPart(i);mesh.setColorAt(i,new THREE.Color(p[6]));});
  let phase=0;
  function pose(player,dt) {
    const speed=Math.hypot(player.vx||0,player.vz||0);
    phase=(phase+dt*Math.min(12,2.4*speed))%(Math.PI*2);
    const swing=player.alive&&player.grounded!==false?Math.sin(phase)*Math.min(.65,speed*.15):0;
    setPart(6,swing);setPart(7,-swing);mesh.instanceMatrix.needsUpdate=true;
    group.rotation.z=THREE.MathUtils.damp(group.rotation.z,player.alive?0:Math.PI*.48,12,dt);
  }
  return {group,pose,dispose(){mesh.dispose();geometry.dispose();material.dispose();}};
}
