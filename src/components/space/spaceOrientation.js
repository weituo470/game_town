import * as THREE from 'three';
import {CITY_BASIS,cityToWorld,orbitWorldPose,sampleElevator} from '../../../shared/space-elevator.js';
export const cityMatrix=new THREE.Matrix4().makeBasis(...CITY_BASIS.map(p=>new THREE.Vector3(...p)));
const origin=cityToWorld([0,0,0]);cityMatrix.setPosition(...origin);
export const cityQuaternion=new THREE.Quaternion().setFromRotationMatrix(cityMatrix);
const axis=new THREE.Vector3(1,0,0),localQ=new THREE.Quaternion(),matrix=new THREE.Matrix4();
export function orientSpaceAvatar(object,pose,now){
 if(pose.spaceMode==='orbit')object.quaternion.copy(cityQuaternion).multiply(localQ.setFromAxisAngle(axis,orbitWorldPose({x:pose.orbitX,y:pose.orbitY,z:pose.orbitZ}).rotationX)).multiply(localQ.setFromAxisAngle(new THREE.Vector3(0,1,0),pose.yaw||0));
 else if(pose.spaceMode==='ascent'||pose.spaceMode==='descent'){
   const shot=sampleElevator(now-pose.spaceStartAt,pose.spaceMode);object.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...shot.up));
 }else object.rotation.set(0,pose.yaw||0,0);
}
