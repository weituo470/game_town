/** Original, texture-free LED artwork. No remote images, canvas or private clock. */
export const sphereWallVertexShader = /* glsl */`
  varying vec3 vSphere;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  #include <fog_pars_vertex>
  void main() {
    vSphere = normalize(position);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const sphereWallFragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uMode;
  uniform float uNextMode;
  uniform float uBlend;
  uniform float uNight;
  uniform float uReduced;
  varying vec3 vSphere;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  #include <fog_pars_fragment>
  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;
  float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
  float noise21(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash21(i), hash21(i+vec2(1.,0.)), f.x), mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y);
  }
  float fbm(vec2 p) { return noise21(p)*.57 + noise21(p*2.03+17.)*.28 + noise21(p*4.13-9.)*.15; }
  float oval(vec2 p, vec2 radius) { return length(p / radius) - 1.0; }
  float ink(float d) { float aa=max(fwidth(d), .002); return 1.0-smoothstep(-aa,aa,d); }
  float pulse(float value, float center, float width) { float p=(value-center)/width; return exp(-p*p); }

  vec3 faceArt(vec3 n, float t) {
    vec2 p=vec2(atan(n.x,n.z), asin(clamp(n.y,-1.,1.)));
    vec3 color=vec3(1.,.69,.018);
    float front=smoothstep(.02,.18,n.z);
    float beat=mod(t,16.0);
    float blink=(pulse(beat,3.4,.10)+pulse(beat,3.76,.085)+pulse(beat,11.2,.12))*(1.0-uReduced);
    blink=clamp(blink,0.,.97);
    float surprise=(smoothstep(7.0,8.1,beat)-smoothstep(10.1,11.0,beat))*(1.0-uReduced);
    float glance=(smoothstep(.7,1.8,beat)-smoothstep(4.5,5.7,beat))*.08;
    glance-=(smoothstep(11.8,12.8,beat)-smoothstep(14.4,15.6,beat))*.065;
    glance*=1.0-uReduced;
    for (int side=0;side<2;side++) {
      float s=side==0?-1.:1.;
      vec2 center=vec2(s*.29,.23);
      float open=1.0-blink;
      vec2 q=p-center;
      vec2 radius=vec2(.215,.28*open+.009);
      float eye=ink(oval(q,radius))*front;
      color=mix(color,vec3(.98,.98,.91),eye);
      vec2 pupil=q-vec2(glance, -.027+surprise*.025);
      float pupilMask=ink(oval(pupil,vec2(.088,.131)))*eye;
      color=mix(color,vec3(.009,.012,.018),pupilMask);
      float glint=ink(oval(pupil-vec2(-.027,.047),vec2(.025,.036)))*pupilMask;
      color=mix(color,vec3(1.),glint*.98);
      // A short arched eyebrow, with a deliberate one-sided inquisitive lift.
      float browLift=surprise*.075 + (side==0?1.:0.)*.07*(smoothstep(4.7,5.5,beat)-smoothstep(6.3,7.,beat))*(1.0-uReduced);
      float browX=clamp(q.x/.215,-1.,1.);
      float arch=.565 + browLift + .085*(1.0-browX*browX);
      float brow=ink(abs(p.y-arch)-.018)*(1.-smoothstep(.18,.215,abs(q.x)))*front;
      color=mix(color,vec3(.055,.029,.01),brow);
    }
    // The small surprised mouth is part of the supplied expression, not a
    // giant emoji grin. Its anticipation/open/relax stages are continuous.
    float mouth=ink(oval(p-vec2(0.,-.205),vec2(.062+surprise*.027,.092+surprise*.065)))*front;
    color=mix(color,vec3(.035,.014,.006),mouth);
    float lip=ink(oval(p-vec2(-.009,-.235-surprise*.035),vec2(.031,.014)))*mouth;
    color=mix(color,vec3(.47,.095,.03),lip*.55);
    return color;
  }

  vec3 eyeArt(vec3 n, float t) {
    vec2 p=vec2(atan(n.x,n.z),asin(clamp(n.y,-1.,1.)));
    vec2 gaze=vec2(sin(t*.24)*.13,sin(t*.17)*.045)*(1.0-uReduced);
    vec2 q=p-gaze; float r=length(q), angle=atan(q.y,q.x);
    vec3 color=vec3(.89,.94,.87);
    float iris=ink((r-.66)/.66)*smoothstep(.0,.22,n.z);
    float radial=sin(angle*117.+sin(angle*23.)*5.+r*37.)*.5+.5;
    float fibers=pow(radial,3.)*(.35+.65*noise21(vec2(angle*39.,r*48.)));
    vec3 irisColor=mix(vec3(.025,.16,.23),vec3(.11,.53,.53),fibers);
    float innerRing=(r-.28)/.12;
    irisColor=mix(irisColor,vec3(.55,.30,.065),exp(-innerRing*innerRing)*.67);
    irisColor*=.65+.35*(1.-smoothstep(.44,.64,r));
    color=mix(color,irisColor,iris);
    float pupilRadius=.205+.018*sin(t*.37)*(1.0-uReduced);
    float pupil=ink((r-pupilRadius)/pupilRadius)*iris;
    color=mix(color,vec3(.003,.008,.011),pupil);
    float shine=ink(oval(q-vec2(-.17,.22),vec2(.14,.055)))*iris;
    float shine2=ink(oval(q-vec2(.12,-.13),vec2(.034,.04)))*iris;
    color=mix(color,vec3(.95,1.,1.),shine*.83+shine2*.6);
    return color;
  }

  float landOval(vec2 p,vec2 center,vec2 radius) { return length((p-center)/radius)-1.; }
  vec3 earthArt(vec3 n,float t) {
    float longitude=atan(n.x,n.z)+t*.055;
    longitude=mod(longitude+PI,TAU)-PI;
    float latitude=asin(clamp(n.y,-1.,1.)); vec2 p=vec2(longitude,latitude);
    // Original analytic continental silhouettes, deliberately no map texture.
    float land=landOval(p,vec2(-1.65,.58),vec2(.53,.46));
    land=min(land,landOval(p,vec2(-1.31,.20),vec2(.29,.22)));
    land=min(land,landOval(p,vec2(-1.10,-.50),vec2(.28,.59)));
    land=min(land,landOval(p,vec2(.15,.57),vec2(.43,.25)));
    land=min(land,landOval(p,vec2(.32,-.10),vec2(.40,.52)));
    land=min(land,landOval(p,vec2(.96,.65),vec2(.89,.43)));
    land=min(land,landOval(p,vec2(1.39,.10),vec2(.30,.41)));
    land=min(land,landOval(p,vec2(1.96,-.65),vec2(.36,.25)));
    land+=(fbm(p*9.)-.5)*.32;
    float continent=1.-smoothstep(-.035,.035,land);
    vec3 ocean=mix(vec3(.012,.08,.25),vec3(.025,.24,.49),.5+.5*cos(latitude*2.));
    float desert=(latitude-.30)/.27;
    float arid=exp(-desert*desert);
    vec3 ground=mix(vec3(.07,.31,.16),vec3(.57,.42,.18),arid*.78);
    ground*=.82+fbm(p*13.)*.32;
    vec3 color=mix(ocean,ground,continent);
    color=mix(color,vec3(.83,.94,.92),smoothstep(1.19,1.47,abs(latitude)));
    float cloud=fbm(vec2(longitude*3.5+t*.016,latitude*7.0)+vec2(sin(latitude*6.)*.5,0.));
    cloud=smoothstep(.55,.77,cloud)*.83;
    color=mix(color,vec3(.95,.98,1.),cloud);
    return color;
  }

  vec3 basketballArt(vec3 n,float t) {
    float spin=t*.08; float c=cos(spin),s=sin(spin);
    n=vec3(n.x*c+n.z*s,n.y,-n.x*s+n.z*c);
    float seam=min(abs(n.y),abs(n.x));
    seam=min(seam,min(abs(n.x-.57*(1.-n.y*n.y)),abs(n.x+.57*(1.-n.y*n.y))));
    vec2 uv=vec2(atan(n.x,n.z),asin(clamp(n.y,-1.,1.)));
    float grain=noise21(uv*190.);
    float grainFade=1.-smoothstep(.5,1.6,max(fwidth(uv.x),fwidth(uv.y))*190.);
    vec3 color=vec3(.86,.245,.036)*(.93+.10*grain*grainFade);
    float groove=1.-smoothstep(.012,.022,seam);
    color=mix(color,vec3(.035,.018,.01),groove);
    return color;
  }
  vec3 artwork(float mode,vec3 n,float t) {
    if(mode<.5) return faceArt(n,t);
    if(mode<1.5) return eyeArt(n,t);
    if(mode<2.5) return earthArt(n,t);
    return basketballArt(n,t);
  }
  void main() {
    vec3 n=normalize(vSphere);
    vec3 color=artwork(uMode,n,uTime);
    if(uBlend>.001) color=mix(color,artwork(uNextMode,n,uTime),uBlend);
    vec2 uv=vec2(atan(n.x,n.z)/TAU+.5,asin(clamp(n.y,-1.,1.))/PI+.5);
    vec2 grid=uv*vec2(480.,240.), cell=fract(grid)-.5;
    float footprint=max(fwidth(grid.x),fwidth(grid.y));
    float beadVisibility=1.-smoothstep(.35,1.2,footprint);
    float aa=max(fwidth(cell.x),fwidth(cell.y));
    float bead=1.-smoothstep(.335-aa,.38+aa,length(cell));
    color*=mix(.94,.20+.80*bead,beadVisibility);
    vec3 viewDirection=normalize(cameraPosition-vWorldPosition);
    float facing=clamp(dot(normalize(vWorldNormal),viewDirection),0.,1.);
    float sunlight=.63+.37*max(0.,dot(n,normalize(vec3(-.5,.8,1.))));
    float volume=mix(sunlight,.78+.22*sqrt(facing),uNight);
    color*=volume*mix(1.03,1.19,uNight);
    color+=vec3(.10,.14,.17)*pow(1.-facing,3.)*.12*(1.-uNight);
    gl_FragColor=vec4(color,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
