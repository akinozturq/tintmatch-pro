import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface GlossaryTerm {
  id: string;
  category: string;
  title: string;
  shortDesc: string;
  content: string;
  formula?: string;
  standards?: string[];
}

export const Glossary: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({
    chnspec: true,
    rm400: true,
    kubelkamunk: true,
    kmthickness: true,
    multistart: true,
  });

  const toggleItem = (id: string) => {
    setOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const terms: GlossaryTerm[] = [
    {
      id: 'chnspec',
      category: 'Spektrofotometri & Donanım',
      title: 'CHNSpec DS-36D & d/8° Entegre Küre Geometrisi (SCI vs. SCE)',
      shortDesc: 'Entegre küre difüz aydınlatma geometrisiyle yüzey parlaklığını içeren (SCI) veya dışlayan (SCE) spektral ölçüm mimarisi.',
      formula: 'Geometri: d/8° (Difüz aydınlatma / 8° gözlem açısı)\nÖlçüm Modu: SCI (Speküler Dahil) & SCE (Speküler Hariç)',
      standards: ['ASTM E1331', 'ISO 7724-1', 'DIN 5033', 'CIE No. 15'],
      content: `
CHNSpec DS-36D, yüksek hassasiyetli bir entegre küre (integrating sphere) spektrofotometresidir. Kürenin iç yüzeyi yüksek yansıtıcılığa sahip baryum sülfat (BaSO4) kaplamadır ve numuneyi tüm yönlerden homojen şekilde (difüz) aydınlatır.

Temel Ölçüm Prensipleri ve Ayrımı:
1. Speküler Dahil (SCI - Specular Component Included):
   - Yüzeyin fiziksel pürüzlülüğü, matlığı veya parlaklığı hesaba katılmaksızın malzemenin saf pigmentasyon kimyasını ve gerçek rengini ölçer.
   - Bilgisayarlı Renk Eşleme (CCM) ve Kubelka-Munk karakterizasyonu için zorunlu geometri standardıdır; formülasyon hesaplamaları her zaman SCI verisiyle yapılmalıdır.
2. Speküler Hariç (SCE - Specular Component Excluded):
   - Yansıma açısına denk gelen optik tuzak kapağını (gloss trap) mekanik olarak açarak parlaklık parıltısını dışlar.
   - İnsan gözünün yüzey parlaklığını ve dokusunu ayırt ederek rengi algılama biçimini yansıtır. Kalite kontrol (QC) tolerans onaylarında tercih edilir.
3. Çift Modlu Senkron Okuma: DS-36D tek bir ölçüm tetiklemesinde hem SCI hem de SCE spektrumunu eşzamanlı olarak alır.
      `,
    },
    {
      id: 'rm400',
      category: 'Spektrofotometri & Donanım',
      title: 'X-Rite RM400 Ölçüm Prensipleri & 45°/0° Geometrisi',
      shortDesc: 'Dairesel 45° aydınlatma ve dik algılama ile insan gözünün görsel parlaklık algısını simüle eden taşınabilir optik geometri.',
      formula: 'Geometri: 45° dairesel aydınlatma / 0° dikey algılama (Speküler yansıma hariç - SPEX)',
      standards: ['ASTM E1164', 'ISO 7724-1', 'DIN 5033'],
      content: `
X-Rite RM400, boya, kaplama ve mürekkep sanayiinde saha ve tezgah uygulamalarında kullanılan dairesel 45°:0° optik geometrisine sahip taşınabilir bir spektrofotometredir.

Temel Özellikler:
1. 45°:0° Optik Düzen: Numune yüzeyine dairesel olarak 45 derecelik açıyla odaklanan ışık, yüzeyden aynasal yansıyan (speküler) parıltıyı 0 derecede duran dedektörden uzaklaştırır. Dedektör sadece kaplamanın içine nüfuz edip saçılan renkli ışığı ölçer.
2. Optik Geometri İzolasyonu: 45°/0° geometrisi ile d/8° entegre küre geometrisi fiziksel olarak eşdeğer değildir. TintMatch PRO mimarisinde iki geometrinin karakterizasyonları ayrı kimliklerde izole edilir ve karıştırılmaz.
3. 400 - 700 nm Spektral Çözünürlük: Görünür spektrum 10 nm aralıklarla 31 dalga boyunda taranır.
      `,
    },
    {
      id: 'calibrationgate',
      category: 'Spektrofotometri & Donanım',
      title: 'Cihaz Kalibrasyon Sert Kapısı (Calibration Hard-Gate & 8h Expiry)',
      shortDesc: 'Spektrofotometrelerin sıcaklık kayması ve optik kirlenmesini önlemek için 8 saatlik vardiya aşımında ölçümü engelleyen güvenlik mimarisi.',
      formula: 'Durum Makinesi: UNCALIBRATED → VALID (0-7h) → EXPIRING_SOON (7-8h) → EXPIRED (>8h)\nEngelleme: HTTP 428 Precondition Required (Override: force_measure=True → EXPIRED_FORCED)',
      standards: ['ISO 17025', 'ASTM E275', 'ISO 9001'],
      content: `
Endüstriyel renk laboratuvarlarında spektrofotometreler ortam sıcaklığı dalgalanmaları, optik optik kirlenme ve lamba yaşlanmasından doğrudan etkilenir. Kalibrasyonu geçersiz bir cihazla yapılan CCM karakterizasyonu tüm laboratuvar veri tabanını bozar.

Güvenlik Mekanizması:
1. İki Noktalı Fiziksel Kalibrasyon: Siyah tuzak (sıfır yansıma / black trap) ve sertifikalı beyaz karo (standart seramik referans) ile sıfırlanır.
2. 8 Saatlik Vardiya Sert Kapısı: Cihazın son kalibrasyonundan bu yana 8 saat geçtiğinde API katmanı ölçüm isteklerini HTTP 428 Precondition Required hatası ile kesin olarak reddeder.
3. Saat Manipülasyonu Tespiti: Bilgisayar sistem saatinin geriye alınması veya zaman kayması durumunda sürücü durumu otomatik olarak CALIBRATION_INVALID seviyesine düşürür.
4. Acil Durum Denetim İzi: Kalibrasyon kilitlendiğinde laborantın zorunlu ölçüm yapabilmesi için force_measure bayrağı sunulur; ancak bu ölçüm veri tabanına açıkça EXPIRED_FORCED olarak damgalanır.
      `,
    },
    {
      id: 'saunderson',
      category: 'Renk Karakterizasyonu & Optik',
      title: 'Saunderson Yüzey Düzeltmesi (k1 & k2 Fresnel Katsayıları)',
      shortDesc: 'Boya filmi ile hava arasındaki kırılma indisi farkından doğan Fresnel dış yansıması ve iç yayılma yansımasını düzeltir.',
      formula: 'R_i = (R_m - k1) / (1 - k1 - k2 + k2 * R_m)\nR_m = k1 + ((1 - k1)(1 - k2) * R_i) / (1 - k2 * R_i)',
      standards: ['ISO 18314-2', 'ASTM E308'],
      content: `
Klasik Kubelka-Munk teorisi, boya filminin sonsuz derinlikte ve hava ile arayüzü bulunmayan ideal bir ortamda olduğunu varsayar. Ancak gerçek hayatta, boya tabakasının yüzeyinde Fresnel parlaklığı ve iç yansımalar oluşur:

1. Dış Fresnel Yansıması (k1 ~ 0.04): Işık havadan boya tabakasına (kırılma indisi n ~ 1.5) geçerken yaklaşık %4'ü doğrudan yüzeyden yansır.
2. İç Yayılma Yansıması (k2 ~ 0.40 - 0.60): Pigment taneciklerinden saçılan ışık tekrar havaya çıkmaya çalışırken, kritik açıyı aşan ışınlar boya filminin içine geri yansır.
3. Analitik Çift Yönlü Bijeksiyon: TintMatch PRO, Saunderson dönüşümünü ve ters Saunderson dönüşümünü 10^-6 numerik hassasiyetle çalıştırır. Düzeltme uygulanmadan K/S matrisleri konsantrasyonla doğrusal toplanamaz.
      `,
    },
    {
      id: 'kubelkamunk',
      category: 'Renk Karakterizasyonu & Optik',
      title: 'Kubelka-Munk Teorisi (Tek Sabitli ve Çift Sabitli Model)',
      shortDesc: 'Pigmentlerin ışığı soğurma (K) ve saçma (S) özelliklerini konsantrasyona bağlayan modern CCM matematik motoru.',
      formula: 'Tek Sabitli: K/S = (1 - R_inf)^2 / (2 * R_inf)\nÇift Sabitli: a = 1 + K/S, b = sqrt(a^2 - 1), R = [1 - Rg(a - b*coth(bSx))] / [a + b*coth(bSx) - Rg]',
      standards: ['ISO 18314-1', 'ASTM D2805'],
      content: `
1931 yılında Paul Kubelka ve Franz Munk tarafından geliştirilen bu teori, endüstriyel renklendirme sistemlerinin temel taşıdır:

1. Tek Sabitli Model (Single-Constant K/S): Opak beyaz baz boyalarda (Base A) saçılmayı tamamen beyaz pigment (TiO2) üstlendiği için saçılma katsayısı S sabit kabul edilir. Karışımın K/S değeri her bir pastanın konsantrasyonuyla doğrusal olarak toplanır: (K/S)_mix = (K/S)_baz + Σ (c_i * (K/S)_i).
2. Çift Sabitli Model (Two-Constant K, S): Şeffaf bazlarda (vernik/ahşap cilaları) ve derin bazlarda (Base C, D) pigmentlerin kendi saçılmaları (S_i) ihmal edilemez. Her dalga boyunda hem soğurma katsayısı K(λ) hem de saçılma katsayısı S(λ) en küçük kareler optimizasyonuyla ayrı ayrı türetilir.
3. Şeffaf Limit & Beer-Lambert: Saçılmanın sıfıra gittiği durumlarda (S → 0) denklem düzgün şekilde Beer-Lambert yasasına (R = Rg * exp(-2*K*x)) asimptotik olarak bağlanır.
      `,
    },
    {
      id: 'kmthickness',
      category: 'Renk Karakterizasyonu & Optik',
      title: 'K-M Film Kalınlığı & Kritik Örtücülük Kalınlığı (x_98)',
      shortDesc: 'ASTM D2805 / ISO 2814 uyumlu %98 örtücülük kalınlığı hesabı ve siyah/beyaz çift tabaka yansımalarından kalınlık tersinimi.',
      formula: 'x_98 = argmin_x { CR(x) >= 98.0% }\nR(x, Rg) = [1 - Rg(a - b*coth(bSx))] / [a + b*coth(bSx) - Rg]',
      standards: ['ASTM D2805', 'ISO 2814', 'DIN 53778'],
      content: `
Boya ve kaplamaların formülasyonunda renk kadar filmin örtücülük kalınlığı da maliyet ve performans açısından kritiktir:

1. Kritik Örtücülük Kalınlığı (x_98):
   - ASTM D2805 ve ISO 2814 standartlarına göre Leneta kontrast oranı CR = Y_siyah / Y_beyaz değerinin %98.0 seviyesine ulaştığı minimum film kalınlığıdır (mikrometre cinsinden).
   - TintMatch PRO, türetilen K ve S spektrumlarını kullanarak kaplamanın örtmesi için gereken minimum film kalınlığını analitik olarak hesaplar.
2. Çift Alt Tabaka Kalınlık Kalibrasyonu:
   - Siyah zemin (Rg1 = 0.04) ve beyaz zemin (Rg2 = 0.82) üzerine çekilen numunenin her iki reflektansından film kalınlığı x ve optik saçılma katsayısı S*x doğrudan tersine çevrilerek kalibre edilir.
      `,
    },
    {
      id: 'loocv',
      category: 'Renk Karakterizasyonu & Optik',
      title: 'Dış-Örneklem Çapraz Doğrulaması (LOOCV) & Model Genelleştirme',
      shortDesc: 'K-M karakterizasyon matrisinin aşırı öğrenmesini engelleyen ve görülmemiş konsantrasyonları tahmin gücünü test eden kalite kapısı.',
      formula: 'LOOCV Folds: n >= 4 konsantrasyon serisi\nKalite Kapısı: Ortalama ΔE00 <= 0.30, Maksimum Fold ΔE00 <= 0.50 (Tolerans Profili)',
      standards: ['ISO 18314-1', 'ASTM E308'],
      content: `
Endüstriyel renk eşlemede karakterizasyonun en büyük tuzağı "aşırı öğrenme" (overfitting) problemidir: Model eğitildiği konsantrasyonları kusursuz hatırlayabilir (Self-fit ΔE00 < 0.20), ancak aradaki veya dışındaki yeni bir konsantrasyonda başarısız olabilir.

TintMatch PRO LOOCV Metodolojisi:
1. n ≥ 4 Konsantrasyon Zorunluluğu: En az 4 farklı seyreltme serisi (örn. %0.1, %0.5, %2.0, %10.0) olmadan genelleştirme güvenliği sağlanamaz.
2. Leave-One-Out Testi: Her adımda bir konsantrasyon veri setinden çıkarılır. K-M katsayıları kalan verilerle hesaplanır ve dışarıda bırakılan konsantrasyonun rengi tahmin edilir.
3. Çift Eşikli Kalite Kapısı:
   - Ortalama Fold Hatası: Ortalama ΔE00 ≤ 0.30 olmalıdır.
   - En Kötü Fold Hatası: Hiçbir tekil konsantrasyonda ΔE00 > 0.50 olamaz.
      `,
    },
    {
      id: 'multistart',
      category: 'Bilgisayarlı Renk Eşleme (CCM)',
      title: 'Çoklu Başlangıçlı (Multi-Start) SLSQP & NNLS Aday Eleme',
      shortDesc: 'CIEDE2000 non-konveks yüzeylerinde yerel minimumlara takılmayı önleyen çoklu başlangıçlı ve NNLS ön elemeli kısıtlı optimizasyon motoru.',
      formula: 'Optimizasyon: min ΔE00(c) subject to Σ c_i <= max_load, c_i >= 0\nBaşlangıçlar: x0_nnls, x0_zero, x0_uniform, x0_pert, x0_greedy',
      standards: ['ISO 18314-1', 'DIN 6174'],
      content: `
CCM renk eşleme probleminde hedef spektruma ulaşmak, kısıtlı doğrusal olmayan bir optimizasyon problemidir (Constrained Non-linear Optimization):

1. NNLS Aday Elemesi (Non-Negative Least Squares):
   - Kütüphanedeki onlarca pasta arasından hedef rengin K/S soğurma profiline en uygun K adet adayı (K ≥ 4) doğrusal olmayan optimizasyon öncesinde matematiksel olarak seçer.
   - Nokta çarpım (spectral correlation) yöntemlerine kıyasla pastel tonlarda açık sarı gibi kritik pigmentleri kaçırmadığı doğrulanmıştır.
2. Çoklu Başlangıçlı SLSQP (Sequential Least Squares Programming):
   - CIEDE2000 elipsoidal renk farkı formülü konveks değildir; yerel minimum tuzakları barındırır.
   - Çoklu başlangıç (Multi-start) algoritması optimizasyonu farklı başlangıç noktalarından (NNLS çözümü, homojen dağılım, rastgele perturbasyonlar) eşzamanlı başlatarak küresel optimumu bulur.
3. ConstraintEngine 2.0 Kısıt Denetimi:
   - Sert kütle tavanı (örn. toplam pasta ≤ %10.0), grup limitleri (örn. sarı pastalar toplamı ≤ %2.0) ve dispansasyon hassasiyeti altındaki mikro dozajların budanmasını yönetir.
      `,
    },
    {
      id: 'cxf3',
      category: 'Bilgisayarlı Renk Eşleme (CCM)',
      title: 'ISO 17972-3 CxF3 Spektral Veri Formatı & PCHIP Normalizasyonu',
      shortDesc: 'Uluslararası standart XML tabanlı spektral veri değişimi, dalga boyu ızgara interpolasyonu ve round-trip doğrulaması.',
      formula: 'Standart Izgara: 400 nm - 700 nm @ 10 nm (31 kanal)\nİnterpolasyon: PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)',
      standards: ['ISO 17972-3', 'ISO 17972-1', 'CxF/X-4'],
      content: `
CxF3 (Color Exchange Format version 3), spektrofotometreler, laboratuvar CCM sistemleri ve baskı makineleri arasında renk ve spektral eğri alışverişini sağlayan ISO 17972 standardıdır:

1. XML Şeması ve Spektral Veri:
   - ReflectanceSpectrum elemanı içinde başlangıç dalga boyu (StartWL), adım aralığı (Step) ve yansıma dizisi yer alır.
   - Ölçüm geometrisi, aydınlatıcı ve konsantrasyon metaverisi taşınır.
2. PCHIP İnterpolasyonu:
   - 20 nm adımlı (16 nokta) veya 380–730 nm geniş aralıklı ham spektrofotometre dosyaları, şekil koruyucu PCHIP algoritmasıyla standart 31 kanallı (400–700 nm @ 10 nm) endüstriyel ızgaraya normalize edilir.
3. Çift Yönlü Dışa Aktarım (Export):
   - Karakterize edilmiş numuneler ISO 17972-3 uyumlu XML olarak üretilebilir ve 10^-5 spektral hassasiyetle kayıpsız içe/dışa aktarılır.
      `,
    },
    {
      id: 'canonicalhash',
      category: 'Bilgisayarlı Renk Eşleme (CCM)',
      title: 'Deterministik Kanonik Formülasyon Hash\'i (SHA-256) & İzlenebilirlik',
      shortDesc: 'Optimizasyon girdilerinin sıralamadan bağımsız kanonik SHA-256 imzası ile bit düzeyinde tekrarlanabilirlik ve denetim izi.',
      formula: 'Hash = SHA-256( CanonicalJSON( Target_R, Base_KS, SortedPastes, Constraints, Profile ) )\nHassasiyet: 10^-9 tekrarlanabilirlik garantisi',
      standards: ['ISO 9001', 'FDA 21 CFR Part 11 uyumlu denetim izi'],
      content: `
Endüstriyel boya üretiminde bir reçetenin aylar sonra bile tam olarak aynı pigment oranlarını üretmesi ve laboratuvarda kim tarafından ne zaman hesaplandığının kanıtlanması gerekir:

1. Permütasyon Bağımsızlığı (Permutation Invariance):
   - Kütüphanedeki pastaların veya bileşenlerin listeye hangi sırayla girildiği optimizasyon sonucunu ve hash kimliğini değiştiremez; girdiler kanonik sıralamayla hashlenir.
2. Deterministik Tekrarlanabilirlik:
   - Aynı optik şartlarda yapılan ardışık hesaplamalar ve çok iş parçacıklı (multithreaded) çalıştırmalar 10^-9 toleransla bit düzeyinde özdeş reçeteler üretir.
3. Deneme Geçmişi (Recipe History):
   - Laborantın yaptığı her What-If ayarlaması, kütle marjı ve optik katsayılar bu hash ile ilişkilendirilerek reçete geçmişine kaydedilir.
      `,
    },
    {
      id: 'ciede2000',
      category: 'Kolorimetri & Kalite Kontrol',
      title: 'CIEDE2000 (ΔE00) Renk Farkı & D65/10° Şartları',
      shortDesc: 'İnsan gözünün kroma, ton ve açıklık algısındaki eliptik tolerans bölgelerini modelleyen uluslararası renk farkı formülü.',
      formula: 'ΔE00 = sqrt((ΔL\'/kL*SL)^2 + (ΔC\'/kC*SC)^2 + (ΔH\'/kH*SH)^2 + RT*(ΔC\'/kC*SC)*(ΔH\'/kH*SH))',
      standards: ['ISO/CIE 11664-6', 'ASTM D2244', 'DIN 6174'],
      content: `
CIE76 (ΔE*ab) ve CMC formüllerinin yetersiz kaldığı noktalarda geliştirilen CIEDE2000, insan gözünün algısal homojenliğini sağlar:

1. D65 Aydınlatıcı (6504 K): Ortalama gün ışığını temsil eden uluslararası standart ışıktır.
2. 10° Ek Standart Gözlemci (CIE 1964): 4 dereceden büyük numunelerde retinanın fovea dışındaki çubuk hücrelerini de hesaba katarak endüstriyel boya kalite kontrolünde zorunlu tutulur.
3. Mavi Bölge Rotasyon Terimi (R_T): Mavi bölgedeki (ton açısı ~275°) elips rotasyonu telafi edilir.
4. TintMatch Pro Doğrulama Eşiği: CCM matris karakterizasyonunda ortalama ΔE00 < 0.30 değeri 'Mükemmel Endüstriyel Uyum' kabul edilir.
      `,
    },
    {
      id: 'metamerism',
      category: 'Kolorimetri & Kalite Kontrol',
      title: 'Metamerizm & Bileşik Metamerizm İndeksi (MI)',
      shortDesc: 'Gün ışığında birebir aynı görünen iki rengin, mağaza veya akkor lamba altında farklı renklere dönüşmesi olgusu.',
      formula: 'MI(A) = |ΔE00(Illuminant A) - ΔE00(D65)|\nMI(F11) = |ΔE00(TL84 / F11) - ΔE00(D65)|\nMI_composite = 0.5 * MI(A) + 0.5 * MI(F11)',
      standards: ['ASTM E805', 'DIN 6172'],
      content: `
Metamerizm, boya ve kaplama sektöründe en sık karşılaşılan müşteri şikayetlerinin başındadır:

1. Neden Oluşur?: Hedef numunenin formülasyonunda kullanılan pigmentler ile CCM laboratuvarında kullanılan pigmentlerin spektral yansıma eğrileri örtüşmediğinde metamerizm meydana gelir.
2. Çoklu Aydınlatıcı Denetimi:
   - D65 (Günışığı, 6504 K)
   - Illuminant A (2856 K Akkor / Tungsten Lamba)
   - F11 / TL84 (4000 K Mağaza Floresanı)
   - F2 (Soğuk Beyaz Floresan)
3. Reçete B (Light Stability): TintMatch PRO'nun optimizasyon motoru, Reçete B profilinde formülasyona bileşik metamerizm cezası ekleyerek mağaza ve ev ışıklarında renk değiştirmeyen en kararlı reçeteyi türetir.
      `,
    },
    {
      id: 'contrastratio',
      category: 'Kolorimetri & Kalite Kontrol',
      title: 'Kontrast Oranı & %98 Opasite Denetimi (Hiding Power)',
      shortDesc: 'Boya filminin altındaki siyah ve beyaz zemini tamamen kapatabilme yeteneğinin fotometrik ölçümü.',
      formula: 'CR = (Y_siyah / Y_beyaz) * 100% >= 98.0%',
      standards: ['ISO 2814', 'ASTM D2805', 'DIN 53778'],
      content: `
Boya ve kaplama standartlarında bir kaplamanın 'Tam Örtücü' sayılabilmesi için kontrast oranının (CR) en az %98.0 olması şarttır:

1. Ölçüm Protokolü: Boya, siyah ve beyaz satranç desenli Leneta kontrol kartına standart film aplikatörü ile uygulanır.
2. Yansıma Oranı: Siyah zemin üzerindeki tristimulus Y değeri (Y_siyah) ile beyaz zemin üzerindeki tristimulus Y değeri (Y_beyaz) oranlanır.
3. Baz Sınıflandırması:
   - Base A (Opak Beyaz): Yüksek TiO2 içerir, CR ≥ %98.0.
   - Base B (Orta): Düşük TiO2, CR ~ %90 - 95.
   - Base C (Derin): Çok az TiO2, koyu renkler için, CR ~ %65 - 80.
   - Base D (Şeffaf): TiO2 içermez, tam şeffaf cila bazı, CR < %30.
      `,
    },
    {
      id: 'flocculation',
      category: 'Kolorimetri & Kalite Kontrol',
      title: 'Flokülasyon ve Rub-Out (Sürtünme) Testi',
      shortDesc: 'Pastanın baz boya içerisinde kararsız kalması sonucu pigmentlerin topaklanması ve sürtünmeyle renk tonunun açığa çıkması.',
      formula: 'ΔE_RubOut = CIEDE2000(Bölge_Sürtülen, Bölge_Sürtülmeyen) < 0.50 (Geçti)',
      standards: ['ISO 1524', 'ASTM D2369'],
      content: `
Flokülasyon, renklendirici pastanın dispersiyon kalitesini ve reçine-baz uyumunu test etmek için uygulanan pratik bir laboratuvar yöntemidir:

1. Testin Yapılışı: Yaş boya filmi Leneta kartı üzerine 150-200 mikron kalınlığında çekilir. Film yaşken parmak ucuyla dairesel hareketlerle yaklaşık 30 saniye sürtülür (rub-out).
2. Sonucun Değerlendirilmesi: Kuruduktan sonra sürtülen alan ile sürtülmeyen alan spektrofotometre ile ölçülür.
   - Eğer pigmentler floküle olmuşsa, sürtünme enerjisi topakları dağıtır ve sürtülen bölge belirgin şekilde koyulaşır veya rengi açılır.
   - ΔE00 < 0.50 ise pasta ile baz arasındaki ıslanma ve dispersiyon kararlılığı onaylanır.
      `,
    },
  ];

  const categories = ['ALL', ...Array.from(new Set(terms.map((t) => t.category)))];

  const filteredTerms = terms.filter((t) => {
    const matchesCategory = selectedCategory === 'ALL' || t.category === selectedCategory;
    const matchesQuery =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.shortDesc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.standards && t.standards.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase())));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full space-y-4">
      {/* Header */}
      <div className="bg-[#121215] border border-zinc-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-100 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-zinc-400" />
            <span>Renk Bilimi & Spektrofotometri Sözlüğü</span>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            CHNSpec DS-36D (d/8°), X-Rite RM400 (45°:0°), Saunderson, Kubelka-Munk, K-M Kalınlık (x_98), CxF3, LOOCV ve Multi-Start CCM
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Terim, formül veya standart ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-2 pt-1 pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              selectedCategory === cat
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'bg-[#121215] text-zinc-400 border border-zinc-850 hover:bg-zinc-900 hover:text-zinc-300'
            }`}
          >
            {cat === 'ALL' ? 'TÜM TERİMLER' : cat}
          </button>
        ))}
      </div>

      {/* Accordion List */}
      <div className="space-y-2.5">
        {filteredTerms.map((term) => {
          const isOpen = openItems[term.id];
          return (
            <div
              key={term.id}
              className="bg-[#121215] border border-zinc-800 rounded-xl overflow-hidden transition-colors"
            >
              {/* Header clickable */}
              <div
                onClick={() => toggleItem(term.id)}
                className="p-4 flex items-start justify-between cursor-pointer hover:bg-zinc-850/40 transition-colors"
              >
                <div className="space-y-1 pr-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 uppercase tracking-wider">
                      {term.category}
                    </span>
                    {term.standards &&
                      term.standards.map((std, i) => (
                        <span
                          key={i}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900/80 text-zinc-500 border border-zinc-850"
                        >
                          {std}
                        </span>
                      ))}
                  </div>
                  <h3 className="text-sm font-medium text-zinc-100">{term.title}</h3>
                  <p className="text-xs text-zinc-400">{term.shortDesc}</p>
                </div>

                <button className="text-zinc-500 hover:text-zinc-300 mt-1 shrink-0">
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>

              {/* Collapsible Content */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-zinc-850 space-y-3">
                  {/* Formula card if present */}
                  {term.formula && (
                    <div className="p-3 bg-[#09090b] rounded-lg border border-zinc-850 font-mono text-xs text-zinc-300 overflow-x-auto whitespace-pre-wrap">
                      <span className="block text-[10px] text-zinc-500 uppercase font-mono mb-1">
                        Matematiksel Formülasyon / Kontrat:
                      </span>
                      {term.formula}
                    </div>
                  )}

                  {/* Body text */}
                  <div className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line font-sans">
                    {term.content}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredTerms.length === 0 && (
          <div className="p-8 text-center text-xs text-zinc-500 bg-[#121215] border border-zinc-800 rounded-xl">
            Arama kriterinize uygun terim bulunamadı.
          </div>
        )}
      </div>
    </div>
  );
};
