import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { createRainbowCloudPavilion } from './createRainbowCloudPavilion.js';

export default function RainbowCloudPavilion({position=[0,0,0],reducedMotion=false}) {
  const host=useRef(),asset=useRef();
  useLayoutEffect(()=>{
    const parent=host.current,building=createRainbowCloudPavilion();asset.current=building;parent.add(building.group);
    return()=>{parent.remove(building.group);building.dispose();if(asset.current===building)asset.current=null;};
  },[]);
  useFrame((_,delta)=>asset.current?.update(delta,reducedMotion));
  return <group ref={host} name="RainbowCloudPavilion" position={position} dispose={null}/>;
}
