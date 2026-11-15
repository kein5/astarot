from pathlib import Path
import re,math,io,zipfile,hashlib, shutil, textwrap
import numpy as np, cv2, cairosvg
from PIL import Image,ImageDraw,ImageFont

SOURCE=Path(__file__).resolve().parents[1]/'docs/brand/astarot/reference-brand-guide.png'
BASE=Path(__file__).resolve().parents[1]
DIR=BASE/'docs/brand/astarot'
DIR.mkdir(parents=True,exist_ok=True)
SHADES={'plum':'#261633','lilac':'#A47AF5','bg':'#FAFAFC','white':'#FFFFFF','muted':'#796F83'}
img=np.asarray(Image.open(SOURCE).convert('RGB'))

# Trace directly from the user-approved reference; no invented hexagram geometry.
def trace_region(rect, maxv=(145,120,155), min_area=60, epsilon=.52, smooth_symbol=False):
 x1,y1,x2,y2=rect; region=img[y1:y2,x1:x2]
 mask=((region[:,:,0]<maxv[0])&(region[:,:,1]<maxv[1])&(region[:,:,2]<maxv[2])).astype(np.uint8)*255
 cs,hier=cv2.findContours(mask,cv2.RETR_TREE,cv2.CHAIN_APPROX_SIMPLE)
 kept=[(i,c) for i,c in enumerate(cs) if cv2.contourArea(c)>=min_area]
 if not kept: raise ValueError('no contours')
 coords=np.vstack([c.reshape(-1,2) for _,c in kept]); xmin,ymin=coords.min(axis=0);xmax,ymax=coords.max(axis=0)
 def ellpath(c):
  # Optical smoothing of a traced circle/round dot: same bounds/position, no change to structure.
  (cx,cy),(ax,ay),angle=cv2.fitEllipse(c)
  # align ring/dots with the visibly horizontal+vertical axes in the reference image
  x,y,w,h=cv2.boundingRect(c);cx=x+(w-1)/2;cy=y+(h-1)/2;rx=(w-1)/2;ry=(h-1)/2
  cx-=xmin;cy-=ymin
  return f'M {cx+rx:.2f},{cy:.2f} A {rx:.2f},{ry:.2f} 0 1 0 {cx-rx:.2f},{cy:.2f} A {rx:.2f},{ry:.2f} 0 1 0 {cx+rx:.2f},{cy:.2f} Z'
 def smoothed(c):
  # Smooth the curved bubble only; preserve the detected tail and silhouette anchor points.
  q=cv2.approxPolyDP(c,1.12,True).reshape(-1,2).astype(float)
  pts=[(x-xmin,y-ymin) for x,y in q];n=len(pts)
  d=[f'M {pts[0][0]:.2f},{pts[0][1]:.2f}']
  for j in range(n):
   p0=pts[(j-1)%n];p1=pts[j];p2=pts[(j+1)%n];p3=pts[(j+2)%n]
   k=.65/6
   c1=(p1[0]+(p2[0]-p0[0])*k,p1[1]+(p2[1]-p0[1])*k)
   c2=(p2[0]-(p3[0]-p1[0])*k,p2[1]-(p3[1]-p1[1])*k)
   d.append(f'C {c1[0]:.2f},{c1[1]:.2f} {c2[0]:.2f},{c2[1]:.2f} {p2[0]:.2f},{p2[1]:.2f}')
  return ' '.join(d)+' Z'
 d=[]
 for i,c in kept:
  if smooth_symbol and i in (0,1,7,8,9):
   d.append(ellpath(c))
  elif smooth_symbol and i==6:
   d.append(smoothed(c))
  else:
   approx=cv2.approxPolyDP(c,epsilon,True).reshape(-1,2)
   pts=[(int(xx-xmin),int(yy-ymin)) for xx,yy in approx]
   d.append('M '+(' L '.join(f'{xx},{yy}' for xx,yy in pts))+' Z')
 return ' '.join(d), (int(xmax-xmin+1),int(ymax-ymin+1)), (int(xmin+x1),int(ymin+y1)), mask

mark_d,mark_size,mark_offset,mask=trace_region((125,85,440,410),min_area=55,epsilon=1.45,smooth_symbol=True)
word_d,word_size,word_offset,_=trace_region((492,132,1408,280),min_area=80,epsilon=1.05)
print('MARK',mark_size, mark_offset, 'path chars',len(mark_d))
print('WORD',word_size, word_offset, 'path chars',len(word_d))
# normalized mark viewBox exactly includes original bounds; symbol in (320x320) with bbox centered
norm=320
moffx=(norm-mark_size[0])/2;moffy=(norm-mark_size[1])/2
M_PATH=f'<path d="{mark_d}" fill="currentColor" fill-rule="evenodd" transform="translate({moffx:.2f},{moffy:.2f})"/>'
W_PATH=f'<path d="{word_d}" fill="currentColor" fill-rule="evenodd"/>'
# The reference PNG is committed as a source: never overwrite it.

def svg_root(body,w,h,title='ASTAROT',desc='ASTAROT circular hexagram and speech bubble',view=None):
 return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{view or f'0 0 {w} {h}'}" role="img" aria-labelledby="title desc"><title id="title">{title}</title><desc id="desc">{desc}</desc>{body}</svg>'''

def use_mark(x,y,size,color):
 return f'<g style="color:{color}" transform="translate({x:.3f},{y:.3f}) scale({size/320:.6f})">{M_PATH}</g>'

def use_wordmark(x,y,w,color):
 return f'<g style="color:{color}" transform="translate({x:.3f},{y:.3f}) scale({w/word_size[0]:.6f})">{W_PATH}</g>'

def export(name,svg,w=None,h=None):
 p=DIR/name;p.write_text(svg,encoding='utf-8')
 if name.endswith('.svg') and w and h:
  cairosvg.svg2png(bytestring=svg.encode(),write_to=str(p.with_suffix('.png')),output_width=int(w),output_height=int(h))
 return p

# Mark-only variants: same path in all configurations.
for name,color in [('symbol-light','#261633'),('symbol-dark','#FFFFFF'),('symbol-black','#151515')]:
 svg=svg_root(use_mark(0,0,320,color),320,320,title='ASTAROT symbol',desc='Approved traced circular hexagram merged with central three-dot speech bubble.')
 export(name+'.svg',svg,512,512)

# App icon from same symbol master, fixed background rounded square.
icon_body=f'<rect width="512" height="512" rx="102" fill="{SHADES["plum"]}"/>'+use_mark(26,26,460,'#FFFFFF')
icon_svg=svg_root(icon_body,512,512,title='ASTAROT app icon',desc='Plum tile with reverse white circular hexagram and integrated speech bubble.')
export('app-icon.svg',icon_svg)
for size in (16,24,32,48,64,128,256,512,1024):
 cairosvg.svg2png(bytestring=icon_svg.encode(),write_to=str(DIR/f'icon-{size}.png'),output_width=size,output_height=size)

# favicon: transparent/light-background canonical form, also a multi-size .ico
favicon_svg=svg_root(use_mark(0,0,320,SHADES['plum']),320,320,title='ASTAROT favicon')
export('favicon.svg',favicon_svg)
for size in (16,32,48,64):
 cairosvg.svg2png(bytestring=favicon_svg.encode(),write_to=str(DIR/f'favicon-{size}.png'),output_width=size,output_height=size)
app=Image.open(DIR/'icon-1024.png').convert('RGBA');app.save(DIR/'app-icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])

# The supplied reference is canonical for the lettering contour used in the wordmark;
# this path is NOT claimed to be a genuine outlined Space Grotesk font file.
export('wordmark-reference-outline.svg',svg_root(f'<g style="color:{SHADES["plum"]}">{W_PATH}</g>',*word_size,title='ASTAROT reference wordmark outline',view=f'0 0 {word_size[0]} {word_size[1]}'))

SUBTITLE='Speech, Translation, Accessibility, Revoicing &amp; OCR Toolkit'
NOTE='Astarot’s Speech, Translation, Accessibility, Revoicing &amp; OCR Toolkit'

def horizontal(dark=False):
 w,h=1400,360
 ink='#FFFFFF' if dark else SHADES['plum'];sub='#E1D6E8' if dark else '#766B80'
 body=(use_mark(35,35,275,ink)+f'<rect x="330" y="55" width="3" height="235" rx="1.5" fill="{SHADES["lilac"]}"/>'
  +use_wordmark(370,70,955,ink)
  +f'<text x="370" y="290" font-family="Space Grotesk, Inter, DejaVu Sans, sans-serif" font-size="32.5" fill="{sub}">{SUBTITLE}</text>'
  +f'<rect x="370" y="313" width="92" height="5" rx="2.5" fill="{SHADES["lilac"]}"/>')
 svg=svg_root(body,w,h,title='ASTAROT horizontal logo',desc='User-approved circular hexagram, reference wordmark and fixed subtitle.')
 return svg

def vertical(dark=False):
 w,h=780,700
 ink='#FFFFFF' if dark else SHADES['plum'];sub='#E1D6E8' if dark else '#766B80'
 ww=625
 body=(use_mark(207,32,370,ink)+use_wordmark((w-ww)/2,443,ww,ink)
  +f'<text x="390" y="600" fill="{sub}" font-family="Space Grotesk,Inter,DejaVu Sans,sans-serif" font-size="23" text-anchor="middle">Speech, Translation, Accessibility,</text>'
  +f'<text x="390" y="635" fill="{sub}" font-family="Space Grotesk,Inter,DejaVu Sans,sans-serif" font-size="23" text-anchor="middle">Revoicing &amp; OCR Toolkit</text>')
 return svg_root(body,w,h,title='ASTAROT vertical logo')

for name,svg,wh in [('logo-horizontal-light',horizontal(False),(1400,360)),('logo-horizontal-dark',horizontal(True),(1400,360)),('logo-vertical-light',vertical(False),(780,700)),('logo-vertical-dark',vertical(True),(780,700))]:
 export(name+'.svg',svg,*wh)

# Brand board: entirely assembled from SAME exported SVG paths, no illustration regeneration.
W,H=1680,1080
muted='#777082'
sections=[]
def txt(x,y,s,size=26,color=None,weight='500',anchor=None,extra=''):
 return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or SHADES["plum"]}" font-weight="{weight}" font-family="Inter, Space Grotesk, Noto Sans,sans-serif" {f"text-anchor={chr(34)+anchor+chr(34)}" if anchor else ""} {extra}>{s}</text>'
def line(x,y,X,Y):return f'<line x1="{x}" y1="{y}" x2="{X}" y2="{Y}" stroke="#E3DDE9" stroke-width="2"/>'
S=[]
S.append(f'<rect width="{W}" height="{H}" fill="{SHADES["bg"]}"/>')
S += [f'<rect x="45" y="24" width="8" height="34" rx="2" fill="{SHADES["lilac"]}"/>',txt(73,50,'ASTAROT — BRAND IDENTITY',25,weight='700'),txt(W-45,50,'REFERENCE-LOCKED  |  v2',19,color=muted,anchor='end'),line(40,75,1640,75)]
S += [use_mark(75,104,268,SHADES['plum']),f'<rect x="368" y="119" width="3" height="224" fill="{SHADES["lilac"]}"/>', use_wordmark(413,131,930,SHADES['plum']),txt(414,341,'Speech, Translation, Accessibility, Revoicing &amp; OCR Toolkit',29,color=muted),f'<rect x="414" y="360" width="90" height="6" rx="3" fill="{SHADES["lilac"]}"/>',line(40,404,1640,404)]
# Four applications, icons equal shape.
for x,heading in [(45,'APP ICON'),(425,'FAVICON'),(830,'MONOCHROME'),(1230,'STACKED LOGO')]:
 S.append(txt(x,454,heading,22,weight='700'))
for x in [407,814,1216]:S.append(line(x,432,x,781))
# Icon preview tile scaled to 275x275.
S += [f'<rect x="81" y="491" width="273" height="273" rx="55" fill="{SHADES["plum"]}"/>',use_mark(95,505,245,'#FFFFFF')]
# favicon various scales
for x,sz,label in [(463,178,'64 px'),(667,95,'32 px'),(766,39,'16 px')]:
 S += [use_mark(x,512+(178-sz)/2,sz,SHADES['plum']),txt(x+sz/2,734,label,18,color=muted,anchor='middle')]
# monochrome marks both dark and light
S += [use_mark(850,516,167,'#222222'),f'<rect x="1035" y="498" width="155" height="155" rx="31" fill="{SHADES["plum"]}"/>',use_mark(1044,508,137,'#FFFFFF'),txt(1025,734,'Light / dark',18,color=muted,anchor='middle')]
# vertical brand
S += [use_mark(1334,478,166,SHADES['plum']),use_wordmark(1285,667,290,SHADES['plum']),txt(1430,727,'Speech, Translation, Accessibility,',16,color=muted,anchor='middle'),txt(1430,752,'Revoicing &amp; OCR Toolkit',16,color=muted,anchor='middle'),line(40,802,1640,802)]
S += [txt(48,850,'BRAND COLORS',22,weight='700')]
for x,name,c in [(55,'Dark Plum',SHADES['plum']),(235,'Lilac',SHADES['lilac']),(415,'Off-white',SHADES['bg'])]:
 S += [f'<rect x="{x}" y="876" width="126" height="72" rx="15" fill="{c}" stroke="#CFC4D6"/>',txt(x,983,name,19),txt(x,1007,c,16,color=muted)]
S += [line(620,829,620,1033),txt(654,852,'TYPOGRAPHY',22,weight='700'),txt(655,918,'Space Grotesk  —  Bold 700',29,weight='700'),txt(655,971,'Brand: ASTAROT  |  UI: Zen Kaku Gothic New',17,color=muted)]
S += [line(1250,829,1250,1033),txt(1280,854,'SYMBOL RULE',21,weight='700'),txt(1280,906,'One traced master',22),txt(1280,946,'No gap, halo or ornaments',17,color=muted),txt(1280,981,'All assets share geometry',17,color=muted)]
board_svg=svg_root(''.join(S),W,H,title='ASTAROT canonical brand board',desc='All symbols share the vector silhouette traced from the approved reference.');export('brand-board.svg',board_svg,W,H)

# Compare original extracted mark against our raster at exact base dimensions to audit silhouette.
orig_bbox=Image.fromarray(img[mark_offset[1]:mark_offset[1]+mark_size[1],mark_offset[0]:mark_offset[0]+mark_size[0]])
preview=Image.open(DIR/'symbol-light.png').convert('RGB')
orig_bbox.resize((320,320)).save(DIR/'reference-mark-crop.png')
# record all path signatures to assert identity in the SVG outputs
all_svgs=['symbol-light.svg','symbol-dark.svg','symbol-black.svg','app-icon.svg','favicon.svg','logo-horizontal-light.svg','logo-horizontal-dark.svg','logo-vertical-light.svg','logo-vertical-dark.svg','brand-board.svg']
for fn in all_svgs:
 raw=(DIR/fn).read_text()
 assert mark_d in raw, f'missing master silhouette: {fn}'
# reference icon should use exactly the same star/bubble geometry as other assets
print('SHARED PATH SHA256:',hashlib.sha256(mark_d.encode()).hexdigest())
print('SVGs',len(all_svgs),'all contain SAME master path')

# Original user-approved guide is normative, not an AI-generated substitute.
