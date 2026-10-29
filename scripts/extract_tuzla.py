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

# Building tuple: [ring, height, levels, kind, roofColour, wallColour, roofShape, minH, holes].
# kind 0 civic, 1 apartment, 2 industrial, 3 house, 4 commercial, 5 religious, 6 auxiliary, 7 sports.
KIND_SETS=[
 (5,{'mosque','place_of_worship','chapel','church','cathedral','temple','synagogue','shrine'}),
 (0,{'school','university','college','kindergarten','hospital','clinic','public','civic','government','townhall','train_station','fire_station','police','library','post_office','courthouse'}),
 (7,{'stadium','grandstand','sports_hall','riding_hall','pavilion','sports_centre'}),
 (4,{'commercial','retail','supermarket','office','kiosk','shop','hotel','mall','marketplace'}),
 (2,{'industrial','warehouse','factory','hangar','manufacture','storage_tank','silo','works'}),
 (6,{'garage','garages','shed','greenhouse','farm_auxiliary','farm','service','transformer_tower','hut','carport','barn','stable','toilets'}),
 (3,{'house','detached','semidetached_house','terrace','bungalow','villa','cabin'}),
 (1,{'apartments','residential','dormitory'}),
]
ROOF_SHAPES={'flat':1,'hipped':2,'half-hipped':2,'side_hipped':2,'gabled':3,'saltbox':3,'gambrel':3,'mansard':3,'pyramidal':4,'dome':5,'onion':5,'skillion':6,'lean_to':6,'sawtooth':7,'round':7,'gothic':7}
def building_kind(typ,tags):
    vals={typ,(tags.get('amenity') or '').lower(),(tags.get('building:use') or '').lower(),(tags.get('leisure') or '').lower()}
    if tags.get('shop'):vals.add('shop')
    if tags.get('religion') and typ in ('yes','religious'):vals.add('place_of_worship')
    for k,names in KIND_SETS:
        if vals & names:return k
    return 1  # 'yes' (any levels) and other unlisted types stay residential blocks
def roof_shape(tags):
    return ROOF_SHAPES.get((tags.get('roof:shape') or '').strip().lower(),0)
def min_height(tags):
    m=number(tags.get('min_height'))
    if m is None:
        lv=number(tags.get('building:min_level'))
        m=lv*3.05 if lv is not None else None
    return round(m,1) if m and 0<m<300 else 0
def highway_like(tags):
    return bool(tags.get('highway') or tags.get('railway') or tags.get('waterway') or tags.get('power') or tags.get('barrier'))
def compact(b):
    """Drop trailing default (0 / '' / []) optional fields after the colour slots."""
    while len(b)>6 and b[-1] in (0,'',[],None):b.pop()
    return b
def join_rings(parts):
    """Join open member ways of a multipolygon into closed coordinate rings."""
    parts=[list(p) for p in parts if p and len(p)>=2]; rings=[]
    while parts:
        cur=parts.pop()
        while cur[0]!=cur[-1]:
            for i,p in enumerate(parts):
                if p[0]==cur[-1]:cur+=p[1:]
                elif p[-1]==cur[-1]:cur+=p[::-1][1:]
                elif p[-1]==cur[0]:cur=p+cur[1:]
                elif p[0]==cur[0]:cur=p[::-1]+cur[1:]
                else:continue
                parts.pop(i);break
            else:break
        if cur[0]==cur[-1] and len(cur)>=4:rings.append(cur)
    return rings

class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__(); self.n={}; self.wc={}; self.bidx={}; self.buildings=[]; self.roads=[]; self.land=[]; self.trees=[]; self.pois=[]; self.counts=collections.Counter(); self.start=time.time()
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
        if not highway_like(w.tags):
            mc=[self.n.get(ref.ref) for ref in w.nodes]
            if mc and all(c is not None for c in mc):self.wc[w.id]=mc  # possible multipolygon member (often untagged)
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
            self.add_building(w.tags,building,coords,[],w.id)
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
    def add_building(self,tags,building,coords,holes,wid=None):
        mid=(sum(p[0] for p in coords[:-1])/(len(coords)-1),sum(p[1] for p in coords[:-1])/(len(coords)-1))
        if not poly.contains(Point(*mid)):return
        typ=building.lower()
        if typ in ('no','roof','construction','ruins','demolished'):return
        h=number(tags.get('height')); levels=number(tags.get('building:levels'))
        if h is not None and not (2<=h<=350):h=None
        if levels is not None and not (1<=levels<=80):levels=None
        # Preserve known values; any later inferred height remains explicitly labelled as such.
        kind=building_kind(typ,tags)
        a=flat(coords[:-1])
        if len(a)<6:return
        roof=(tags.get('roof:colour') or tags.get('roof:color') or '')[:25]
        wall=(tags.get('building:colour') or tags.get('building:color') or '')[:25]
        hs=[flat(r[:-1]) for r in holes if len(r)>=4]
        if wid is not None:self.bidx[wid]=len(self.buildings)
        self.buildings.append([a,round(h,1) if h else 0,round(levels,1) if levels else 0,kind,roof,wall,roof_shape(tags),min_height(tags),hs])
        self.counts['known_height' if h else ('known_levels' if levels else 'inferred')]+=1
        if hs:self.counts['with_courtyard']+=1
        if tags.get('name'):
            self.pois.append([tags.get('name'),round(mid[1],6),round(mid[0],6),'building'])
    def relation(self,r):
        """Building multipolygons (type=multipolygon/building) with inner courtyard rings."""
        if r.tags.get('type') not in ('multipolygon','building'):return
        outer,inner=[],[]
        for m in r.members:
            if m.type!='w':continue
            c=self.wc.get(m.ref)
            if c is None:continue
            (inner if m.role=='inner' else outer).append((m.ref,c))
        if not outer:return
        building=r.tags.get('building') or r.tags.get('building:part')
        inner_rings=join_rings([c for _,c in inner])
        if not building:
            # Old-style tagging: the building tag sits on a single closed outer way.
            if len(outer)==1 and outer[0][0] in self.bidx and inner_rings:
                b=self.buildings[self.bidx[outer[0][0]]]
                b[8]=b[8]+[flat(r_[:-1]) for r_ in inner_rings]
                self.counts['with_courtyard']+=1
            return
        for ring in join_rings([c for _,c in outer]):
            shp=Polygon(ring)
            holes=[h_ for h_ in inner_rings if shp.contains(Point(*h_[0]))]
            ids=[wid for wid,c in outer if c[0]==c[-1] and c==ring and wid in self.bidx]
            if ids:  # outer way was already emitted as a building: attach the holes instead of duplicating
                b=self.buildings[self.bidx[ids[0]]]
                if holes:b[8]=b[8]+[flat(h_[:-1]) for h_ in holes]; self.counts['with_courtyard']+=1
                continue
            self.add_building(r.tags,building,ring,holes)
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
h.wc.clear()
h.buildings=[compact(b) for b in h.buildings]
kind_counts=collections.Counter(b[3] for b in h.buildings)
print('Nodes in bbox',len(h.n),'elapsed',round(time.time()-h.start,1),'s',flush=True)
points=BOUNDARY['geojson']['coordinates'][0]
result={
 'meta':{'name':'Tuzla, İstanbul','osmRelation':1276010,'osmDate':'2026-10-29','origin':[LAT0,LON0],'projection':'Local Web Mercator, kilometres','buildingCount':len(h.buildings),'roadCount':len(h.roads),'treeCount':len(h.trees),'heightStats':dict(h.counts),'buildingSchema':'[ring,height,levels,kind,roofColour,wallColour,roofShape?,minH?,holes?]','kindCounts':{str(k):kind_counts[k] for k in range(8)}},
 'boundary':flat(points), 'buildings':h.buildings,'roads':h.roads,'land':h.land,'trees':h.trees,'pois':h.pois
}
OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Saved',OUT,'bytes',OUT.stat().st_size,'buildings',len(h.buildings),'roads',len(h.roads),'land',len(h.land),'trees',len(h.trees),'pois',len(h.pois),'heights',dict(h.counts),flush=True)
