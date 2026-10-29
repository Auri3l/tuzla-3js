# tuzla-3js

Tuzla'ya ait bir 3JS çalışması, artan AI creditleri detaylandırması için harcıyorum. Dışarıdan destekleri de beklerim.

Tuzla, İstanbul'un OpenStreetMap verisi, arazi yükseklik verisi ve açık lisanslı uydu görüntüsüyle oluşturulmuş, canlı ve etkileşimli bir Three.js modeli. `tuzla-3d-preview.html` tek başına, internet bağlantısı olmadan WebGL2 destekleyen güncel bir tarayıcıda açılır; harita verisi, görüntüler, yazı tipleri ve kodun tamamı bu dosyanın içindedir.

English documentation: [README.en.md](README.en.md)

## Özellikler

- **Binalar:** 19.681 bina; kat ve pencere düzenli cepheler (apartman, cam ofis, sanayi kaplaması, müstakil ev), zemin katta tenteli dükkânlar, konutlarda kiremit kırma ve piramit çatılar, düz çatılarda güneş enerjisi panelleri ve su depoları, fabrikalarda oluklu metal çatılar. Büyük çatıların rengi uydu görüntüsünden alınır; sanayi binaları OSM arazi kullanımına göre belirlenir. İsmi bilinen 59 camiye kubbe ve minare eklenir.
- **Işık ve zaman:** Fiziksel tabanlı malzemeler, Tuzla'nın enlemine ve bugünün tarihine göre hesaplanan gerçek güneş konumu, gün saati kaydırıcısı, "Şimdi" düğmesi ve zaman akışı, kamerayı izleyen gölgeler. Gece pencereler ve yaklaşık 20.000 sokak lambası yanar, yıldızlar çıkar; yüksek kalitede bloom etkisi.
- **Deniz:** Uydu görüntüsü, yükseklik verisi ve OSM su poligonlarından türetilen su maskesi; dalgalar, gökyüzü yansıması, derinliğe göre renk ve kıyı köpüğü. Marmara ufka kadar devam eder.
- **Bitki örtüsü:** OSM'deki ağaçlar ile orman, park, bahçe, mezarlık (selviler), çalılık ve konut aralarına yerleştirilen yaklaşık 95.000 ağaç; fıstık çamları ve rüzgârda sallanma.
- **Canlılık:** Gerçek yol ağında akan trafik (otobüsler, gece far ve stop lambaları), Marmaray trenleri, demirli ve seyreden yük gemileri, tersane rıhtımlarındaki gemiler, römorkörler ve Viaport Marina'daki yatlar. Bunlar simülasyondur, gerçek zamanlı veri değildir.
- **Yollar:** Araziyi takip eden kesintisiz yol şeritleri, şerit çizgileri, orta refüj, bordürler, demiryolu traversleri ve rayları, İstanbul Park pistinde kırmızı-beyaz bordürler. Yollar ilçe ölçeğinde de görünür kalır.
- **Arayüz:** Türkçe ve İngilizce; mahalle, istasyon, cami, okul, park ve isimli bina araması; mahalle ve önemli yer etiketleri; binaya tıklayınca bilgi kartı (çift tık: yakınlaş); sokak seviyesinde yürüme modu (WASD / oklar, Shift ile koşma, dokunmatik düğmeler); otomatik tur; bina yüksekliği ayarı; Düşük / Orta / Yüksek kalite; katmanlar; paylaşılabilir görünüm linki (`#enlem,boylam,mesafem,yön,eğim,tSAAT`); ekran görüntüsü ve tam ekran.
- **Performans:** Tüm geometri bir Web Worker'da üretilir (worker koda gömülüdür, tek dosya çevrimdışı çalışmaya devam eder); binalar görüş alanı kırpması için bölgelere ayrılır; ağaçlar mesafeye göre gizlenen parçalar halindedir; kare hızı düştüğünde çözünürlük kendiliğinden azalır; arka plandaki sekmede çizim durur.

## Kullanım

- Fareyle sürükleyerek döndürün, tekerlek veya iki parmakla yakınlaşın. **İlçeyi gör** tüm ilçeyi gösterir.
- Yer kartlarından veya haritadaki etiketlerden birini seçerek oraya uçun. Mobilde kart şeridini yana kaydırın.
- Tuval odaktayken: oklar döndürür, W A S D kaydırır, `+` / `−` yakınlaştırır, `N` kuzeyi yukarı alır, `0` veya `Home` sahile döner, `/` aramaya odaklanır.

## Kaynak projeyi çalıştırma

Node.js 20.19+ veya 22.12+ gerekir:

```bash
npm ci
npm run dev
```

Yayın için `npm run build` çalıştırıp `dist/` klasörünü bir web sunucusunda yayınlayın. Tek dosyalık HTML'i yeniden üretmek için `npm run build:standalone` (Python 3 gerekir).

## Proje yapısı

- `src/engine/index.js`: sahne kurulumu, kamera, bina seçimi, yürüme modu, etiketler, çizim döngüsü.
- `src/engine/geometry.worker.js`: bina gövdeleri ve çatılar, yol şeritleri, lambalar, trafik yolları, demiryolu hatları ve ağaç yerleşimi.
- `src/engine/materials.js`: cephe dokusu ile bina, arazi/su ve yol shader'ları.
- `src/engine/sky.js`, `src/engine/life.js`: gökyüzü ve güneş; ağaçlar, trafik, trenler ve gemiler.
- `src/main.js`, `src/i18n.js`, `index.html`, `style.css`: arayüz, Türkçe/İngilizce metinler ve öne çıkan yerler.
- `public/data/`: işlenmiş OSM geometrisi, yükseklik ızgarası, 2017 uydu mozaiği, stillendirilmiş zemin dokusu ve su maskesi.
- `scripts/`: veri hazırlama betikleri (`make_water_mask.py` yalnızca Pillow ve numpy ister).

## Doğruluk

- İlçe sınırı [OSM relation 1276010](https://www.openstreetmap.org/relation/1276010). Veri 28 Ekim 2026 tarihli OSM Türkiye özütünden alınmıştır.
- Binaların yalnızca 21'inde yükseklik, 2.230'unda kat etiketi vardır; geri kalanların yüksekliği alan ve kullanıma göre tahmin edilir. Cepheler ve çatılar prosedüreldir; hiçbir bina fotoğrafik kopya değildir.
- Arazi 1,35×, binalar varsayılan olarak 1,25× (ayarlardan 1–2,5×) dikey olarak abartılmıştır. Ölçüm veya navigasyon amaçlı değildir.
- Uydu görüntüsü 2017 tarihli Sentinel-2 cloudless (~10 m çözünürlük) mozaiğidir ve bugünkü haritayla örtüşmeyebilir.

## Veri ve lisanslar

- **OpenStreetMap:** harita verisi © [OpenStreetMap katkıcıları](https://www.openstreetmap.org/copyright), [ODbL](https://opendatacommons.org/licenses/odbl/) lisansıyla. [Geofabrik Türkiye özütü](https://download.geofabrik.de/europe/turkey.html) ve OSM API.
- **Uydu:** *Sentinel-2 cloudless 2017*, [EOX IT Services GmbH](https://s2maps.eu/) (değiştirilmiş Copernicus Sentinel verisi 2017), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Renkler değiştirilmiş, ilçe dışı karartılmıştır.
- **Yükseklik:** [Tilezen/Mapzen Terrain Tiles](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), [AWS Open Data](https://registry.opendata.aws/terrain-tiles/) üzerinden. Avrupa verisi Avrupa Birliği tarafından finanse edilen Copernicus verileriyle (EU-DEM); küresel GMTED2010 ve SRTM verileri U.S. Geological Survey'den.
- **Kod ve yazı tipleri:** Three.js, earcut ve Vite MIT lisanslıdır. DM Sans ve Playfair Display SIL Open Font License ile dağıtılır; lisanslar `public/fonts/` içindedir.
