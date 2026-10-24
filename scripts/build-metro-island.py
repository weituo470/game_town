"""Original, repeatable Blender authoring for the continuous-world metropolis.

Run with Blender 5.2 --background --python scripts/build-metro-island.py.
No downloads, add-ons, render farm, scene camera, ocean or lights are required.
The JSON is the single source for footprints used by visual AND server collision.
"""
import bpy
import json
import math
import hashlib
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
LAYOUT_FILE = ROOT / 'shared' / 'metro-layout.json'
LAYOUT_BYTES = LAYOUT_FILE.read_bytes()
LAYOUT = json.loads(LAYOUT_BYTES)
I = LAYOUT['island']
OUT = ROOT / 'public' / 'metro-island'
OUT.mkdir(parents=True, exist_ok=True)
RNG = random.Random(902514)
# This generator owns city.blend; do not copy redundant .blend1 backups into
# the static site's public directory on every deterministic regeneration.
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

def point(x, y, z):
    # World X / height Y / world Z -> Blender right-handed Z-up.
    # glTF's +Y-up conversion maps this back to Three [x-I.x, y, z-I.z].
    return (x-I['x'], -(z-I['z']), y)

MATERIALS = {}
BATCH = {}

def texture(name, size, kind):
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    data = []
    for row in range(size):
        for col in range(size):
            n = RNG.random()
            if kind == 'asphalt':
                base = .19 + n*.07
                if n > .97: base += .08
                rgb = (base*.87, base*.94, base)
            elif kind == 'paving':
                joint = col % (size//4) < 2 or row % (size//4) < 2
                base = (.42 if joint else .66) + n*.06
                rgb = (base, base*.99, base*.96)
            elif kind == 'stone':
                base = .61 + n*.08 + math.sin(col*.17+math.sin(row*.2))*.025
                rgb = (base*1.02, base, base*.96)
            elif kind == 'grass':
                base = .32+n*.22
                rgb = (base*.55, base, base*.43)
            else:
                base = .72+n*.14
                rgb = (base*.93, base*.98, base)
            data.extend((*rgb, 1))
    image.pixels.foreach_set(data)
    image.file_format = 'PNG'
    image.filepath_raw = str(OUT / (name + '.png'))
    image.save()
    image.pack()
    return image

IMAGES = {kind: texture('metro-original-'+kind, 256, kind) for kind in ['asphalt', 'paving', 'stone', 'grass']}

def leaf_texture():
    size=128
    image=bpy.data.images.new('metro-original-fine-branchlets',width=size,height=size,alpha=True)
    data=[]
    for row in range(size):
        for col in range(size):
            u=(col/(size-1)-.5)*2; v=row/(size-1)
            alpha=1.0 if abs(u)<.012 and v<.91 else 0.0
            vein=0
            for pair in range(7):
                for side in [-1,1]:
                    ay=.07+pair*.115+(side<0)*.025
                    bx=side*(.73-pair*.06); by=ay+.16-pair*.008
                    dx=bx;dy=by-ay;length=dx*dx+dy*dy
                    along=(u*dx+(v-ay)*dy)/length
                    if not 0<along<1: continue
                    cross=abs(u*dy-(v-ay)*dx)/math.sqrt(length)
                    edge=math.sin(along*math.pi)**.8*(.061+(6-pair)*.003)
                    if cross<edge:
                        alpha=max(alpha,min(1,(edge-cross)/.006))
                        vein=max(vein,math.exp(-cross*130)*.035)
            light=.91+v*.12+RNG.random()*.07
            data.extend((.10*light+vein,.205*light+vein,.065*light,alpha))
    image.pixels.foreach_set(data);image.file_format='PNG'
    image.filepath_raw=str(OUT/'metro-original-fine-branchlets.png');image.save();image.pack()
    return image

LEAF_IMAGE=leaf_texture()

def material(name, color, rough=.7, metal=0, tex=None, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if tex:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = IMAGES[tex]
        mat.node_tree.links.new(node.outputs['Color'], p.inputs['Base Color'])
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = 0.0
    mat.diffuse_color = (*color, 1)
    MATERIALS[name] = mat
    BATCH[name] = {'v': [], 'f': [], 'uv': []}
    return mat

material('metro-asphalt', (.16,.18,.20), .96, tex='asphalt')
material('metro-paving', (.50,.51,.49), .91, tex='paving')
material('metro-seawall-stone', (.55,.55,.51), .9, tex='stone')
material('metro-park-grass', (.16,.28,.12), .98, tex='grass')
material('metro-warm-limestone', (.61,.57,.49), .84)
material('metro-pale-travertine', (.73,.71,.65), .82)
material('metro-bronze-fins', (.25,.20,.13), .34, .78)
material('metro-aluminium-fins', (.48,.55,.58), .28, .86)
material('metro-charcoal-metal', (.055,.071,.079), .40, .67)
material('metro-roof-equipment', (.23,.27,.29), .70, .35)
material('metro-road-white', (.80,.81,.78), .95)
material('metro-road-amber', (.79,.55,.17), .93)
material('metro-bark', (.14,.105,.065), .98)
material('metro-foliage-dark', (.07,.14,.065), .98)
material('metro-foliage-sage', (.12,.205,.10), .98)
material('metro-foliage-light', (.20,.285,.12), .98)
material('metro-wood', (.28,.17,.09), .89)
material('metro-pool-water', (.035,.17,.19), .15, .54)
material('metro-architectural-light', (.84,.75,.56), .35, .20, emission=(1,.76,.36))
for name, col in [('blue',(.15,.23,.28)), ('silver',(.17,.25,.30)), ('bronze',(.16,.23,.27)), ('shadow',(.14,.22,.27))]:
    material('metro-glass-'+name, col, .20 if name!='bronze' else .26, .66)
for name, col in [('warm',(.16,.205,.23)),('neutral',(.19,.25,.28)),('cool',(.13,.22,.28))]:
    material('metro-window-lit-'+name, col, .22, .44, emission=col)

for name in ['metro-foliage-dark','metro-foliage-sage','metro-foliage-light']:
    mat=MATERIALS[name]; p=mat.node_tree.nodes.get('Principled BSDF')
    node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=LEAF_IMAGE
    mat.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    mat.node_tree.links.new(node.outputs['Alpha'],p.inputs['Alpha'])
    mat.surface_render_method='DITHERED';mat.use_backface_culling=False

def face(mat, pts, uv=None):
    b = BATCH[mat]
    k = len(b['v'])
    b['v'].extend(point(*p) for p in pts)
    b['f'].append(tuple(range(k,k+len(pts))))
    b['uv'].append(uv or [(0,0),(1,0),(1,1),(0,1)][:len(pts)])

def box(mat, x,y,z,w,h,d):
    a,b=x-w/2,x+w/2; c,e=z-d/2,z+d/2; lo,hi=y-h/2,y+h/2
    # Exterior winding in the Three coordinate convention; Blender transform is proper rotation.
    face(mat,[(a,lo,e),(b,lo,e),(b,hi,e),(a,hi,e)],[(0,0),(w/4,0),(w/4,h/4),(0,h/4)])
    face(mat,[(b,lo,c),(a,lo,c),(a,hi,c),(b,hi,c)],[(0,0),(w/4,0),(w/4,h/4),(0,h/4)])
    face(mat,[(b,lo,e),(b,lo,c),(b,hi,c),(b,hi,e)],[(0,0),(d/4,0),(d/4,h/4),(0,h/4)])
    face(mat,[(a,lo,c),(a,lo,e),(a,hi,e),(a,hi,c)],[(0,0),(d/4,0),(d/4,h/4),(0,h/4)])
    face(mat,[(a,hi,e),(b,hi,e),(b,hi,c),(a,hi,c)],[(0,0),(w/4,0),(w/4,d/4),(0,d/4)])
    face(mat,[(a,lo,c),(b,lo,c),(b,lo,e),(a,lo,e)])

def rod(mat, a,b,r,segments=8):
    aa,bb=Vector(a),Vector(b)
    direction=(bb-aa).normalized()
    u=direction.cross(Vector((0,1,0)))
    if u.length < .01: u=direction.cross(Vector((1,0,0)))
    u.normalize(); v=direction.cross(u).normalized()
    for i in range(segments):
        t=i*math.tau/segments; q=(i+1)*math.tau/segments
        off1=(u*math.cos(t)+v*math.sin(t))*r
        off2=(u*math.cos(q)+v*math.sin(q))*r
        face(mat,[aa+off1,aa+off2,bb+off2,bb+off1])

def slab(mat,x,z,w,d,top,thickness):
    box(mat,x,top-thickness/2,z,w,thickness,d)

def rounded_deck():
    w,d,r=I['width'],I['depth'],I['cornerRadius']
    pts=[]
    for cx,cz,angle in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for j in range(9):
            t=math.radians(angle+j*90/8)
            # Start at right/bottom corner and wind clockwise in world XZ.
            pts.append((I['x']+cx+math.cos(t)*r, I['z']+cz+math.sin(t)*r))
    center=(I['x'],-.055,I['z'])
    for i,(x,z) in enumerate(pts):
        xx,zz=pts[(i+1)%len(pts)]
        face('metro-paving',[center,(xx,-.055,zz),(x,-.055,z)],[(.5,.5),((xx-I['x'])/4,(zz-I['z'])/4),((x-I['x'])/4,(z-I['z'])/4)])
        face('metro-seawall-stone',[(x,-.055,z),(xx,-.055,zz),(xx,-2.5,zz),(x,-2.5,z)])

rounded_deck()

# Road fabric: real-scale lanes, white edge lines, segmented amber medians,
# four-sided crossings and drains rather than black painted street rectangles.
for road in LAYOUT['roads']:
    x,z,w,d=road['x'],road['z'],road['width'],road['depth']
    slab('metro-asphalt',x,z,w,d,-.018,.04)
    longitudinal=road['axis']=='z'
    length=d if longitudinal else w
    for sign in [-1,1]:
        if longitudinal: slab('metro-road-white',x+sign*5.35,z,.10,length,-.005,.008)
        else: slab('metro-road-white',x,z+sign*5.35,length,.10,-.005,.008)
    for distance in range(-int(length/2)+5,int(length/2)-3,7):
        wx=x if longitudinal else x+distance
        wz=z+distance if longitudinal else z
        crossings=[r for r in LAYOUT['roads'] if r['axis']!=road['axis']]
        if any(abs((wz-r['z']) if longitudinal else (wx-r['x']))<10 for r in crossings): continue
        for lane in [-3,3]:
            slab('metro-road-white', wx+lane if longitudinal else wx,-.0+wz if longitudinal else wz+lane,.13 if longitudinal else 2.7,2.7 if longitudinal else .13,.002,.008)
        for median in [-.14,.14]:
            slab('metro-road-amber',wx+median if longitudinal else wx,wz if longitudinal else wz+median,.10 if longitudinal else 3.8,3.8 if longitudinal else .10,.003,.008)

vertical=[r for r in LAYOUT['roads'] if r['axis']=='z']
horizontal=[r for r in LAYOUT['roads'] if r['axis']=='x']
for a in vertical:
    for b in horizontal:
        x,z=a['x'],b['z']
        for s in [-1,1]:
            for k in range(10):
                off=(k-4.5)*.77
                slab('metro-road-white',x+off,z+s*8.2,.38,2.4,.004,.008)
                slab('metro-road-white',x+s*8.2,z+off,2.4,.38,.004,.008)

def window(mat, a,b,c,d):
    face(mat,[a,b,c,d])

def facade(x,z,w,d,bottom,top,style,floors,seed):
    rr=random.Random(seed)
    glass='metro-glass-'+('bronze' if style in ['bronze-grid','warm-stone'] else 'silver' if style=='silver-curtain' else 'blue')
    trim='metro-bronze-fins' if style in ['bronze-grid','warm-stone','sandstone-grid'] else 'metro-aluminium-fins'
    floor_h=(top-bottom)/max(floors,1)
    opening_ratio=.66 if style in ['warm-stone','sandstone-grid'] else .91
    # Whole facade divided into individual recessed window panels with daylight
    # reflective glass and selected separate night-light glass. No emissive tubes.
    for axis,length,depth in [('front',w,d),('back',w,d),('left',d,w),('right',d,w)]:
        n=max(3,round(length/2.6))
        cell=length/n
        for level in range(floors):
            lo=bottom+level*floor_h+.16
            hi=bottom+(level+1)*floor_h-.17
            wh=(hi-lo)*(.79 if style=='warm-stone' else 1)
            cy=(lo+hi)/2
            for j in range(n):
                middle=-length/2+(j+.5)*cell
                left=middle-cell*opening_ratio/2
                right=middle+cell*opening_ratio/2
                a,b=cy-wh/2,cy+wh/2
                # Rectangular glass borders retain a fine metal grid at ground
                # level without wasting 40k separate mesh objects / draw calls.
                mat=glass
                if rr.random()<.37:
                    mat='metro-window-lit-'+rr.choice(['warm','warm','neutral','cool'])
                elif rr.random()<.08: mat='metro-glass-shadow'
                if axis=='front':
                    zz=z+d/2+.025
                    window(mat,(x+left,a,zz),(x+right,a,zz),(x+right,b,zz),(x+left,b,zz))
                elif axis=='back':
                    zz=z-d/2-.025
                    window(mat,(x+right,a,zz),(x+left,a,zz),(x+left,b,zz),(x+right,b,zz))
                elif axis=='right':
                    xx=x+w/2+.025
                    window(mat,(xx,a,z+right),(xx,a,z+left),(xx,b,z+left),(xx,b,z+right))
                else:
                    xx=x-w/2-.025
                    window(mat,(xx,a,z+left),(xx,a,z+right),(xx,b,z+right),(xx,b,z+left))
        # Slim continuous vertical mullions and story transoms cast real shadows.
        for j in range(n+1):
            off=-length/2+j*cell
            if axis in ['front','back']:
                box(trim,x+off,(top+bottom)/2,z+(1 if axis=='front' else -1)*(d/2+.065),.075,top-bottom,.11)
            else:
                box(trim,x+(1 if axis=='right' else -1)*(w/2+.065),(top+bottom)/2,z+off,.11,top-bottom,.075)
        for level in range(floors+1):
            y=bottom+level*floor_h
            if axis in ['front','back']:
                box(trim,x,y,z+(1 if axis=='front' else -1)*(d/2+.07),w+.16,.10,.13)
            else:
                box(trim,x+(1 if axis=='right' else -1)*(w/2+.07),y,z,.13,.10,d+.16)

def roof(x,z,w,d,y,seed):
    slab('metro-roof-equipment',x,z,w,d,y,.22)
    for sign in [-1,1]:
        box('metro-pale-travertine',x,y+.24,z+sign*d/2,w,.48,.18)
        box('metro-pale-travertine',x+sign*w/2,y+.24,z,.18,.48,d)
    for k in range(3):
        xx=x+(k-1)*w*.22
        box('metro-roof-equipment',xx,y+.7,z,w*.16,1.1,d*.22)
        # Cooling-fan rings and louvres survive the aerial viewing distance.
        for jj in range(5): box('metro-charcoal-metal',xx,y+.71,z+(jj-2)*.40,w*.165,.10,.11)

def building(b,idx):
    x,z,w,d,h=b['x'],b['z'],b['width'],b['depth'],b['height']
    style=b['style']; podium=5.4 if h>50 else 4.1
    wall='metro-warm-limestone' if style=='warm-stone' else 'metro-pale-travertine' if style=='sandstone-grid' else 'metro-charcoal-metal'
    slab('metro-paving',x,z,w+2.2,d+2.2,-.012,.06)
    # Pedestrian-scale stone podium / full-height storefront / cantilever canopy.
    box(wall,x,podium/2,z,w-.32,podium,d-.32)
    facade(x,z,w-.32,d-.32,.3,podium-.25,'bronze-grid',1,idx+910)
    for sign in [-1,1]:
        box('metro-pale-travertine',x+sign*(w/2-.50),podium/2,z+d/2-.03,.55,podium,.55)
    box('metro-charcoal-metal',x,podium-.10,z+d/2-.55,w*.58,.23,1.75)
    # Entrances have two glass doors, frames and handles, all in the footprint.
    for sign in [-1,1]:
        box('metro-glass-shadow',x+sign*.75,1.45,z+d/2-.10,1.38,2.8,.08)
        rod('metro-aluminium-fins',(x+sign*.27,1.05,z+d/2-.02),(x+sign*.27,1.8,z+d/2-.02),.026)
    bottom=podium+.10
    roof_y=h-1.7
    if style=='setback-glass':
        segments=[(bottom,h*.53,.88),(h*.53,h*.79,.74),(h*.79,roof_y,.58)]
    elif style=='tapered-glass':
        segments=[(bottom,h*.42,.87),(h*.42,h*.70,.77),(h*.70,h*.88,.65),(h*.88,roof_y,.46)]
    else:
        segments=[(bottom,roof_y,.91)]
    for n,(lo,hi,scale) in enumerate(segments):
        ww,dd=w*scale,d*scale
        box(wall,x,(lo+hi)/2,z,ww,hi-lo,dd)
        floors=max(2,round((hi-lo)/(h/b['floors'])))
        facade(x,z,ww,dd,lo+.12,hi-.14,style,floors,idx*31+n)
        roof(x,z,ww,dd,hi,idx)
        # Planted open terraces at setbacks, not featureless stacked cubes.
        if n<len(segments)-1:
            nextscale=segments[n+1][2]
            margin=(scale-nextscale)*w/2
            for sign in [-1,1]:
                box('metro-charcoal-metal',x+sign*(ww/2-.75),hi+.4,z,.9,.7,dd*.65)
                box('metro-foliage-dark',x+sign*(ww/2-.75),hi+.9,z,.8,.55,dd*.63)
    # Crown fins and top equipment are deliberately bounded by shared solid roof Y.
    topw=w*segments[-1][2]; topd=d*segments[-1][2]
    for sign in [-1,1]:
        box('metro-aluminium-fins',x+sign*(topw/2-.12),h-.60,z,.16,1.1,topd)
    if style=='tapered-glass':
        # Four-dimensional faceted crown, no unbounded antenna above collision.
        apex=(x,h-.02,z)
        a=topw*.29; c=topd*.29
        for A,B in [((x-a,roof_y+.7,z-c),(x+a,roof_y+.7,z-c)),((x+a,roof_y+.7,z-c),(x+a,roof_y+.7,z+c)),((x+a,roof_y+.7,z+c),(x-a,roof_y+.7,z+c)),((x-a,roof_y+.7,z+c),(x-a,roof_y+.7,z-c))]:
            face('metro-glass-silver',[A,B,apex],[(0,0),(1,0),(.5,1)])

for idx,b in enumerate(LAYOUT['buildings']): building(b,idx+1)

def tree(x,z,height=8,seed=0):
    rr=random.Random(seed+301)
    rod('metro-bark',(x,0,z),(x+.20,height*.64,z),.16,7)
    for j in range(7):
        theta=j*2.39+rr.random()*.4
        branch_h=height*(.42+j*.055)
        spread=height*(.23 if j<5 else .15)
        ex=x+math.cos(theta)*spread; ez=z+math.sin(theta)*spread
        ey=branch_h+height*.2
        rod('metro-bark',(x,branch_h,z),(ex,ey,ez),.07,6)
        # Original alpha-cut 14-leaf branchlets. No icospheres / solid polygon
        # balls: every cluster is a small three-dimensional spray of fine leaves.
        for cluster in range(7):
            cx=ex+rr.uniform(-1.0,1.0); cz=ez+rr.uniform(-1.0,1.0); cy=ey+rr.uniform(-.65,1.3)
            mat=['metro-foliage-dark','metro-foliage-sage','metro-foliage-light'][(j+cluster+seed)%3]
            rod('metro-bark',(ex,ey,ez),(cx,cy,cz),.018,5)
            for arm in range(3):
                angle=arm*math.tau/3+rr.random()*.65
                length=rr.uniform(.90,1.32); width=length*.92
                side=Vector((-math.sin(angle),0,math.cos(angle)))*width/2
                base=Vector((cx,cy,cz)); tip=Vector((math.cos(angle)*.44,.80,math.sin(angle)*.44))*length
                face(mat,[base-side,base+side,base+side+tip,base-side+tip])

# Street trees in generous grates; all positions avoid crossroads / building walls.
tree_positions=[]
for road in vertical:
    for offset in [-78,-46,-15,15,46,78]:
        z=I['z']+offset
        if any(abs(z-r['z'])<13 for r in horizontal): continue
        for sign in [-1,1]: tree_positions.append((road['x']+sign*8.6,z))
for idx,(x,z) in enumerate(tree_positions):
    slab('metro-charcoal-metal',x,z,2,2,.007,.03)
    tree(x,z,7.1+(idx%3)*.8,idx)

# Linear sea promenade, benches, low stainless handrails, bollards and planting.
edge_x=I['width']/2-I['promenade']['inset'] if 'promenade' in I else I['width']/2-LAYOUT['promenade']['inset']
edge_z=I['depth']/2-LAYOUT['promenade']['inset']
for sign in [-1,1]:
    slab('metro-pale-travertine',I['x'],I['z']+sign*edge_z,I['width']-28,4.7,-.005,.06)
    slab('metro-pale-travertine',I['x']+sign*edge_x,I['z'],4.7,I['depth']-28,-.005,.06)
    for off in range(-114,115,12):
        x=I['x']+off; z=I['z']+sign*(edge_z+2)
        rod('metro-aluminium-fins',(x,0,z),(x,1.12,z),.035,6)
        if off<110: rod('metro-aluminium-fins',(x,1.10,z),(x+12,1.10,z),.035,6)
    for off in range(-84,85,12):
        x=I['x']+sign*(edge_x+2); z=I['z']+off
        rod('metro-aluminium-fins',(x,0,z),(x,1.12,z),.035,6)
        if off<80: rod('metro-aluminium-fins',(x,1.10,z),(x,1.10,z+12),.035,6)

def bench(x,z):
    for j in range(4): box('metro-wood',x,.58,z+(j-1.5)*.14,2.4,.10,.11)
    for s in [-1,1]: box('metro-charcoal-metal',x+s*.92,.3,z,.10,.60,.66)
    for j in range(3): box('metro-wood',x,.92+j*.12,z-.33,2.4,.08,.08)

for x in [-92,-42,48,90,132]: bench(x,I['z']+99)
for x in [-92,-42,3,48,90,132]: bench(x,I['z']-99)

for idx,x in enumerate([-101,-50,0,50,98,140]):
    for z in [-391,-178]:
        if x==0 and z==-178: continue
        tree(x,z,7.3+(idx%2),200+idx)

for park in LAYOUT['parks']:
    x,z,w,d=park['x'],park['z'],park['width'],park['depth']
    slab('metro-park-grass',x,z,w,d,-.020,.06)
    slab('metro-pale-travertine',x,z,w,3,-.009,.03)
    slab('metro-pale-travertine',x,z,3,d,-.008,.03)
    # A shallow reflecting garden with a sculptural stainless Möbius-like ribbon.
    slab('metro-charcoal-metal',x+14,z-7,17,7,.06,.15)
    slab('metro-pool-water',x+14,z-7,16.4,6.4,.085,.03)
    prev=None
    for j in range(50):
        t=j/49*math.tau
        p=(x+14+math.cos(t)*3.8,2.9+math.sin(t)*2.2,z-7+math.sin(t*2)*.62)
        if prev: rod('metro-aluminium-fins',prev,p,.16,8)
        prev=p
    for idx,(dx,dz) in enumerate([(-24,-12),(-13,-12),(-24,12),(-13,12),(0,12),(13,12),(25,12),(25,-12)]):
        tree(x+dx,z+dz,7.5+idx%3,400+idx)
    bench(x-13,z+4);bench(x+13,z+4)

# Architectural LEDs contain emission surfaces only. They use the existing
# town lights; no 30-point-light/shadow performance trap is introduced.
for i,road in enumerate(horizontal):
    for idx,offset in enumerate([-112,-65,-20,24,68,112]):
        x=I['x']+offset; z=road['z']+9
        rod('metro-charcoal-metal',(x,0,z),(x,7.2,z),.075,8)
        rod('metro-charcoal-metal',(x,7.2,z),(x,7.2,z-2),.055,8)
        box('metro-charcoal-metal',x,7.2,z-2,.65,.12,1.2)
        box('metro-architectural-light',x,7.12,z-2,.52,.025,1.0)
        box('metro-charcoal-metal',x,0.07,z,.38,.14,.38)

# Low-key arrival plaza: scale is human, not another oversized neon landmark.
slab('metro-pale-travertine',I['arrival']['x'],I['arrival']['z'],14,12,-.006,.05)
for sign in [-1,1]:
    x=I['arrival']['x']+sign*6
    box('metro-charcoal-metal',x,.55,I['arrival']['z'],.9,1.1,.9)
    box('metro-architectural-light',x,.94,I['arrival']['z'],.96,.10,.96)

# Each material is one joined mesh, not one mesh per pane / window / bollard.
objects=[]
for name,b in BATCH.items():
    if not b['f']: continue
    mesh=bpy.data.meshes.new(name+'-geometry')
    mesh.from_pydata(b['v'],[],b['f']); mesh.materials.append(MATERIALS[name]);mesh.update()
    uv=mesh.uv_layers.new(name='UVMap')
    for poly,coords in zip(mesh.polygons,b['uv']):
        for loop,coord in zip(poly.loop_indices,coords): uv.data[loop].uv=coord
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    objects.append(obj)

bpy.context.scene['source_layout_sha256']=hashlib.sha256(LAYOUT_BYTES).hexdigest()
bpy.context.scene['coordinate_mapping']='Blender (worldX-20, -(worldZ+285), worldY) -> glTF/Three (localX, height, localZ)'
bpy.context.scene['original_asset']='Procedurally authored for Game Town; no third-party textures or meshes.'
triangles=sum(sum(max(0,len(p.vertices)-2) for p in o.data.polygons) for o in objects)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'city.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'city.glb'),export_format='GLB',export_yup=True,export_cameras=False,export_lights=False,export_animations=False,export_extras=True,export_materials='EXPORT',export_image_format='AUTO')
asset_revision=hashlib.sha256((OUT/'city.glb').read_bytes()).hexdigest()[:16]
asset_metadata={'revision':asset_revision,'bytes':(OUT/'city.glb').stat().st_size,'path':'/metro-island/city.glb'}
(ROOT/'shared'/'metro-asset.json').write_text(json.dumps(asset_metadata,indent=2)+'\n',encoding='utf-8')

manifest={
    'schemaVersion':1,'generator':'Blender '+bpy.app.version_string,
    'asset':'city.glb','editableSource':None,'generatorSource':'scripts/build-metro-island.py','editableSourceExcluded':'Pre-generated Blender project contains local workstation metadata; regenerate locally with the original generator.','license':'MIT (original geometry and generated raster textures)',
    'layoutSha256':hashlib.sha256(LAYOUT_BYTES).hexdigest(),
    'origin':[I['x'],0,I['z']], 'gltfCoordinateSpace':'local-metres-y-up',
    'mapping':'GLB [x,y,z] -> world [x+20,y,z-285]',
    'buildings':len(LAYOUT['buildings']),'meshes':len(objects),'materials':len(MATERIALS),'triangles':triangles,
    'bytes':(OUT/'city.glb').stat().st_size,'revision':asset_revision,
    'includesLights':False,'includesCameras':False,'includesOcean':False,
    'originalTextures':list(IMAGES.keys())+['fine-branchlets'],
    'foliageMode':'original alpha-cut fine branchlets; no solid crown meshes',
    'buildingBounds':[{'id':b['id'],'x':b['x'],'z':b['z'],'width':b['width'],'depth':b['depth'],'height':b['height']} for b in LAYOUT['buildings']],
}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('METRO_ASSET '+json.dumps({k:manifest[k] for k in ['buildings','meshes','materials','triangles','bytes']}))
assert triangles < 300000, triangles
assert len(objects)<65, len(objects)
assert manifest['bytes']<12*1024*1024, manifest['bytes']
