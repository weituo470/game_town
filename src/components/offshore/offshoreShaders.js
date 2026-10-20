export const offshoreWakeVertexShader = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
export const offshoreWakeFragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uSpeed;
  uniform float uNight;
  varying vec2 vUv;
  void main(){
    float age=vUv.y, x=(vUv.x-.5)*2.;
    float spread=.55+age*.27;
    float dl=(x-spread)/(.027+age*.09),dr=(x+spread)/(.027+age*.09),di=x/(.23+age*.30);
    float left=exp(-dl*dl),right=exp(-dr*dr),inner=exp(-di*di)*.15;
    float churn=sin(age*84.-uTime*5.5+sin(x*31.)*1.6)*.5+.5;
    float lace=.42+.58*smoothstep(.2,.83,churn);
    float fade=smoothstep(0.,.045,age)*(1.-smoothstep(.45,1.,age));
    float alpha=clamp((left+right+inner)*lace*fade*uSpeed*.64,0.,.72);
    gl_FragColor=vec4(mix(vec3(.75,.93,.96),vec3(.48,.72,.81),uNight),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const offshoreSprayVertexShader = /* glsl */`
  uniform float uSpeed;
  void main(){
    vec4 mvPosition=modelViewMatrix*vec4(position,1.);
    gl_Position=projectionMatrix*mvPosition;
    gl_PointSize=clamp(58.*uSpeed/max(1.,-mvPosition.z),1.,6.);
  }
`;
export const offshoreSprayFragmentShader = /* glsl */`
  uniform float uSpeed;
  uniform float uNight;
  void main(){
    float radius=length(gl_PointCoord-.5);
    float alpha=(1.-smoothstep(.12,.5,radius))*.65*uSpeed;
    gl_FragColor=vec4(mix(vec3(.85,.96,1.),vec3(.52,.73,.82),uNight),alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
