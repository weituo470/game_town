from PIL import Image, ImageFont, ImageDraw
import json
from pathlib import Path
font='C:/Windows/Fonts/msyhbd.ttc'
lines=[('moonstone',26),('黑客松',28),('1024',36),('程序员节快乐',25)]
out=[]
for text,size in lines:
 f=ImageFont.truetype(font,size); box=f.getbbox(text); im=Image.new('L',(box[2]-box[0],box[3]-box[1])); ImageDraw.Draw(im).text((-box[0],-box[1]),text,font=f,fill=255)
 points=[[x,y] for y in range(im.height) for x in range(im.width) if im.getpixel((x,y))>140]
 # A checkerboard sample leaves visible gaps between discrete drone lamps.
 points=[p for p in points if p[0]%2==p[1]%2]
 out.append({'text':text,'width':im.width,'height':im.height,'points':points})
 print(text,im.size,len(points))
p=Path('src/components/drone/avatarFestivalGlyphs.js')
p.write_text('// Generated locally from Microsoft YaHei Bold for these four phrases only.\n// Dot coordinates, not a redistributed font. Regenerate: scripts/build-avatar-festival-glyphs.py\nexport const FESTIVAL_GLYPHS = '+json.dumps(out,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')

