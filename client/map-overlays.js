import {Vector3,Matrix3,Matrix4} from 'three';
// The exported Source overlay meshes are offset 0.3937 m along their normals.
// Audited against the shipped opaque geometry (5,155 of 5,312 face samples).
// Keep 3 mm separation plus polygon offset, preserving signs, grime and UVs.
const OVERLAY_RETRACTION=.3907;
export function repairMapOverlays(root){
 let vertices=0,meshes=0;root.updateMatrixWorld(true);
 root.traverse(mesh=>{
  if(!mesh.isMesh||!/_s_mesh_overlay\d+meshset_/.test(mesh.name)||mesh.userData.overlayAligned)return;
  const source=mesh.geometry;if(!source.attributes.normal)return;
  const geometry=source.clone(),position=geometry.attributes.position,normal=geometry.attributes.normal;
  const normalMatrix=new Matrix3().getNormalMatrix(mesh.matrixWorld),inverse=new Matrix4().copy(mesh.matrixWorld).invert(),v=new Vector3(),n=new Vector3();
  for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);n.fromBufferAttribute(normal,i).applyNormalMatrix(normalMatrix);v.addScaledVector(n,-OVERLAY_RETRACTION).applyMatrix4(inverse);position.setXYZ(i,v.x,v.y,v.z);}
  position.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;mesh.userData.overlayAligned=true;mesh.castShadow=false;meshes++;vertices+=position.count;
 });return {meshes,vertices};
}
