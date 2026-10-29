#!/usr/bin/env python3
"""Download an openly licensed Sentinel-2 mosaic and terrain samples for Tuzla."""
import math, json, io, time, requests
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance
from shapely.geometry import shape

OUT=Path('public/data');OUT.mkdir(parents=True,exist_ok=True)
b=json.load(open('tuzla-boundary-nominatim.json'))
poly=shape(b['geojson']); minlon,minlat,maxlon,maxlat=poly.bounds
R=6378137; LAT0=40.89; LON0=29.35; COS=math.cos(math.radians(LAT0))
def merc(lon,lat):return (R*math.radians(lon),R*math.log(math.tan(math.pi/4+math.radians(lat)/2)))
def world(mx,my):
 x0,y0=merc(LON0,LAT0);return ((mx-x0)*COS/1000,(y0-my)*COS/1000)
xmin,ymin=merc(minlon-.006,minlat-.012);xmax,ymax=merc(maxlon+.006,maxlat+.006)
width=1900;height=round(width*(ymax-ymin)/(xmax-xmin))
if height>2048: width=round(width*2048/height);height=2048
params={'SERVICE':'WMS','VERSION':'1.3.0','REQUEST':'GetMap','LAYERS':'s2cloudless-2017_3857','STYLES':'','CRS':'EPSG:3857','BBOX':f'{xmin},{ymin},{xmax},{ymax}','WIDTH':width,'HEIGHT':height,'FORMAT':'image/jpeg'}
r=requests.get('https://tiles.maps.eox.at/wms',params=params,headers={'User-Agent':'Tuzla3D/1.0 research prototype'},timeout=120)
print('WMS',r.status_code,r.headers.get('Content-Type'),len(r.content),r.url,flush=True);r.raise_for_status()
im=Image.open(io.BytesIO(r.content)).convert('RGB')
im=ImageEnhance.Color(im).enhance(1.05)
im.save(OUT/'sentinel-tuzla-2017.jpg',quality=90,optimize=True)
# Terrairum elevation pixels, roughly 30 m/pixel at this zoom.
z=12;n=2**z
def tilexy(lon,lat):
 return ((lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
tx0,ty0=tilexy(minlon-.006,maxlat+.006);tx1,ty1=tilexy(maxlon+.006,minlat-.012)
ix0,iy0=math.floor(tx0),math.floor(ty0);ix1,iy1=math.floor(tx1),math.floor(ty1)
print('Elevation tiles',ix0,ix1,iy0,iy1,flush=True)
tiles={}
for yy in range(iy0,iy1+1):
 for xx in range(ix0,ix1+1):
  u=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{xx}/{yy}.png'
  try:
   r=requests.get(u,headers={'User-Agent':'Tuzla3D/1.0 research prototype'},timeout=30);r.raise_for_status(); tiles[xx,yy]=Image.open(io.BytesIO(r.content)).convert('RGB'); print('terrain',xx,yy,len(r.content),flush=True)
  except Exception as e:print('terrain FAILED',xx,yy,str(e),flush=True)
def el(lon,lat):
 tx,ty=tilexy(lon,lat);xx=int(tx);yy=int(ty);t=tiles.get((xx,yy))
 if t is None:return 0
 px=max(0,min(255,int((tx-xx)*256)));py=max(0,min(255,int((ty-yy)*256)))
 a,b,c=t.getpixel((px,py));e=(a*256+b+c/256)-32768
 return max(0,min(600,round(e,1)))
N=257;heights=[]
for row in range(N):
 my=ymax-(ymax-ymin)*row/(N-1)
 lat=math.degrees(2*math.atan(math.exp(my/R))-math.pi/2)
 for col in range(N):
  mx=xmin+(xmax-xmin)*col/(N-1);lon=math.degrees(mx/R);heights.append(el(lon,lat))
wx0,wz0=world(xmin,ymax);wx1,wz1=world(xmax,ymin)
meta={'grid':N,'bounds':[round(wx0,6),round(wz0,6),round(wx1,6),round(wz1,6)],'heights':heights,'imageSize':[width,height],'elevation':'Tilezen/Mapzen Terrain Tiles via AWS; multiple sources including EU-DEM and SRTM','imagery':'Sentinel-2 cloudless 2017 by EOX, CC BY 4.0 (modified Copernicus Sentinel data 2017)'}
(OUT/'terrain.json').write_text(json.dumps(meta,separators=(',',':')))
print('Ground image',im.size,(OUT/'sentinel-tuzla-2017.jpg').stat().st_size,'height range',min(heights),max(heights),flush=True)
# Research-only image with boundary marked.
preview=im.copy();d=ImageDraw.Draw(preview);p=[]
for lon,lat in b['geojson']['coordinates'][0]:
 mx,my=merc(lon,lat);p.append(((mx-xmin)/(xmax-xmin)*width,(ymax-my)/(ymax-ymin)*height))
d.line(p,fill=(250,220,30),width=4,joint='curve');preview.thumbnail((900,900));preview.save('tuzla-ground-reference.jpg',quality=88)
