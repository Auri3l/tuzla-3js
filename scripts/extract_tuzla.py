#!/usr/bin/env python3
"""Extract a compact, Tuzla-only model from an OSM PBF (Geofabrik, ODbL).

The PBF is read in OSM's normal node-before-way order. Only nodes in a small
bounding rectangle are retained in memory; features are then clipped/tested
against the actual district boundary. Run with Python + osmium + shapely.
"""
import osmium, json, math, re, sys, time, collections
from shapely.geometry import shape, Point, LineString, Polygon, MultiLineString, GeometryCollection
from shapely.prepared import prep
from pathlib import Path

PBF = sys.argv[1] if len(sys.argv)>1 else '/tmp/turkey-latest.osm.pbf'
OUT = Path('public/data/tuzla-osm.json')
BOUNDARY = json.load(open('tuzla-boundary-nominatim.json',encoding='utf-8'))
poly_geo=shape(BOUNDARY['geojson'])
minx,miny,maxx,maxy=poly_geo.bounds
bbox=(minx-.003,miny-.003,maxx+.003,maxy+.003)
poly=prep(poly_geo)
R=6378137.0
LAT0,LON0=40.89,29.35
COS=math.cos(math.radians(LAT0))
Y0=R*math.log(math.tan(math.pi/4+math.radians(LAT0)/2))
def xy(lon,lat):
    return ((R*math.radians(lon-LON0)*COS/1000), ((Y0-R*math.log(math.tan(math.pi/4+math.radians(lat)/2)))*COS/1000))
def flat(coords):
    out=[]
    for lon,lat in coords:
        x,z=xy(lon,lat)
        out.extend((round(x,4),round(z,4)))
    return out
def number(t):
    if not t:return None
    try:
        n=float(re.match(r'[-+]?\d+(?:\.\d+)?',t.strip().replace(',','.')).group())
        if 'ft' in t.lower() or "'" in t:n*=.3048
        return n
    except Exception:return None

class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.n={}; self.buildings=[]; self.roads=[]; self.land=[]; self.trees=[]; self.pois=[]; self.counts=collections.Counter(); self.start=time.time()
    def node(self,n):
        try: lon,lat=n.location.lon,n.location.lat
        except Exception:return
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]): return
        self.n[n.id]=(lon,lat)
        if n.tags.get('natural')=='tree' and poly.contains(Point(lon,lat)):
            self.trees.append(flat([(lon,lat)]))
        name=n.tags.get('name')
        if name and any(n.tags.get(x) for x in ['place','leisure','tourism','railway','amenity','historic','shop']) and poly.contains(Point(lon,lat)):
            self.pois.append([name,round(lat,6),round(lon,6),n.tags.get('place') or n.tags.get('leisure') or n.tags.get('tourism') or n.tags.get('railway') or n.tags.get('amenity') or n.tags.get('shop') or ''])
    def way(self,w):
        building=w.tags.get('building') or w.tags.get('building:part')
        highway=w.tags.get('highway')
        railway=w.tags.get('railway')
        leisure=w.tags.get('leisure')
        natural=w.tags.get('natural')
        landuse=w.tags.get('landuse')
        waterway=w.tags.get('waterway')
        amenity=w.tags.get('amenity')
        is_green=(leisure in ('park','garden','nature_reserve','pitch','playground','golf_course','recreation_ground') or landuse in ('forest','grass','meadow','recreation_ground','cemetery','village_green','orchard','vineyard','farmland','industrial','residential') or natural in ('wood','scrub','grassland','water','wetland','beach'))
        if not (building or highway or railway or is_green or natural=='coastline' or waterway or (w.tags.get('name') and amenity)): return
        coords=[self.n.get(ref.ref) for ref in w.nodes]
        if not coords or all(c is None for c in coords):return
        valid=[c for c in coords if c is not None]
        if len(valid)<2:return
        if building:
            if any(c is None for c in coords) or len(coords)<4 or coords[0]!=coords[-1]:return
            mid=(sum(p[0] for p in coords[:-1])/(len(coords)-1),sum(p[1] for p in coords[:-1])/(len(coords)-1))
            if not poly.contains(Point(*mid)):return
            typ=building.lower()
            if typ in ('no','roof','construction','ruins','demolished'):return
            h=number(w.tags.get('height')); levels=number(w.tags.get('building:levels'))
            if h is not None and not (2<=h<=350):h=None
            if levels is not None and not (1<=levels<=80):levels=None
            # Preserve known values; any later inferred height remains explicitly labelled as such.
            kind=2 if typ in ('industrial','warehouse','factory','commercial','retail','supermarket','hangar','garage','garages','farm','farm_auxiliary') else (1 if typ in ('house','detached','semidetached_house','terrace','bungalow','residential','apartments','yes') else 0)
            a=flat(coords[:-1])
            if len(a)<6:return
            roof=(w.tags.get('roof:colour') or w.tags.get('roof:color') or '')[:25]
            wall=(w.tags.get('building:colour') or w.tags.get('building:color') or '')[:25]
            self.buildings.append([a,round(h,1) if h else 0,round(levels,1) if levels else 0,kind,roof,wall])
            self.counts['known_height' if h else ('known_levels' if levels else 'inferred')]+=1
            if w.tags.get('name'):
                self.pois.append([w.tags.get('name'),round(mid[1],6),round(mid[0],6),'building'])
            return
        # The remaining line and polygon features can be clipped against the district.
        if highway and highway not in ('construction','proposed','abandoned'):
            k={'motorway':4,'motorway_link':4,'trunk':4,'trunk_link':4,'primary':3,'primary_link':3,'secondary':2,'secondary_link':2,'tertiary':2,'tertiary_link':2,'unclassified':1,'residential':1,'living_street':1,'service':0,'pedestrian':0,'footway':0,'path':0,'cycleway':0,'track':0,'raceway':8}.get(highway)
            if k is not None:
                self.add_line(coords,self.roads,k)
        elif railway in ('rail','light_rail','subway','tram'):
            self.add_line(coords,self.roads,5)
        elif natural=='coastline': self.add_line(coords,self.roads,6)
        elif waterway in ('river','stream','canal'):
            self.add_line(coords,self.roads,7)
        if is_green and len(coords)>3 and coords[0] == coords[-1] and all(c is not None for c in coords):
            mid=(sum(p[0] for p in coords[:-1])/(len(coords)-1),sum(p[1] for p in coords[:-1])/(len(coords)-1))
            if poly.contains(Point(*mid)):
                kind=(leisure or natural or landuse or '')
                self.land.append([kind,flat(coords[:-1])])
        name=w.tags.get('name')
        if name and (leisure or amenity or (natural and natural not in ('coastline',))):
            mid=(sum(p[0] for p in valid)/len(valid),sum(p[1] for p in valid)/len(valid))
            if poly.contains(Point(*mid)):self.pois.append([name,round(mid[1],6),round(mid[0],6),leisure or amenity or natural])
    def add_line(self,coords,out,kind):
        seq=[]
        def add(part):
            if len(part)<2:return
            try:
                g=LineString(part).intersection(poly_geo)
                if g.is_empty:return
                if g.geom_type=='LineString': geoms=[g]
                elif g.geom_type in ('MultiLineString','GeometryCollection'):geoms=[t for t in g.geoms if t.geom_type=='LineString']
                else:return
                for line in geoms:
                    ls=list(line.coords)
                    if len(ls)>1:out.append([kind,flat(ls)])
            except Exception:pass
        for c in coords:
            if c is None:add(seq);seq=[]
            else:seq.append(c)
        add(seq)

h=Handler()
print('Reading',PBF,'boundary bbox',bbox,flush=True)
h.apply_file(PBF, locations=False)
print('Nodes in bbox',len(h.n),'elapsed',round(time.time()-h.start,1),'s',flush=True)
points=BOUNDARY['geojson']['coordinates'][0]
result={
 'meta':{'name':'Tuzla, İstanbul','osmRelation':1276010,'osmDate':'2026-10-29','origin':[LAT0,LON0],'projection':'Local Web Mercator, kilometres','buildingCount':len(h.buildings),'roadCount':len(h.roads),'treeCount':len(h.trees),'heightStats':dict(h.counts)},
 'boundary':flat(points), 'buildings':h.buildings,'roads':h.roads,'land':h.land,'trees':h.trees,'pois':h.pois
}
OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Saved',OUT,'bytes',OUT.stat().st_size,'buildings',len(h.buildings),'roads',len(h.roads),'land',len(h.land),'trees',len(h.trees),'pois',len(h.pois),'heights',dict(h.counts),flush=True)
