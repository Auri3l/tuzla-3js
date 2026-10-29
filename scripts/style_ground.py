from PIL import Image,ImageDraw,ImageEnhance
from pathlib import Path
import json,math,numpy as np
b=json.load(open('tuzla-boundary-nominatim.json')); t=json.load(open('public/data/terrain.json')); im=Image.open('public/data/sentinel-tuzla-2017.jpg').convert('RGB');w,h=im.size
R=6378137;lat0=40.89;lon0=29.35;c=math.cos(math.radians(lat0));y0=R*math.log(math.tan(math.pi/4+math.radians(lat0)/2));xmin,zmin,xmax,zmax=t['bounds']
pts=[]
for lon,lat in b['geojson']['coordinates'][0]:
 x=(R*math.radians(lon-lon0)*c/1000);z=(y0-R*math.log(math.tan(math.pi/4+math.radians(lat)/2)))*c/1000
 pts.append(((x-xmin)/(xmax-xmin)*w,(z-zmin)/(zmax-zmin)*h))
mask=Image.new('L',im.size,0);ImageDraw.Draw(mask).polygon(pts,fill=255)
out=ImageEnhance.Color(im).enhance(.55);out=ImageEnhance.Brightness(out).enhance(.58)
result=np.asarray(Image.composite(im,out,mask)).copy().astype('float32')
original=np.asarray(im).astype('float32');r,g,b=original[:,:,0],original[:,:,1],original[:,:,2]
water=(r<70)&(b>r*1.22)&(g>r*1.07)&(b>g*1.03)
# Keep open water blue instead of darkening it with the outside-district mask.
blue=np.array([50,91,111],dtype='float32');result[water]=original[water]*.48+blue*.52
Image.fromarray(np.clip(result,0,255).astype('uint8')).save('public/data/tuzla-ground.jpg',quality=90,optimize=True)
print('ground',w,h,'water pixels',int(water.sum()))
