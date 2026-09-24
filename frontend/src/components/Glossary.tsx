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
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({
    rm400: true,
    saunderson: true,
    kubelkamunk: true,
  });

  const toggleItem = (id: string) => {
    setOpenItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const terms: GlossaryTerm[] = [
    {
      id: 'rm400',
      category: 'Spektrofotometri & Donanım',
      title: 'X-Rite RM400 Ölçüm Prensipleri & 45°/0° Geometrisi',
      shortDesc: 'Endüstriyel renk laboratuvarlarında yüzey dokusunu ve parlaklığı ayrıştırarak insan gözünün algısını simüle eden optik geometri.',
      formula: 'Geometri: 45° aydınlatma / 0° dikey algılama (Speküler yansıma hariç - SCE / SPEX)',
      standards: ['ASTM E1164', 'ISO 7724-1', 'DIN 5033'],
      content: `
X-Rite RM400, boya, kaplama ve mürekkep sanayiinde yüksek tekrarlanabilirlik sunan 45° dairesel aydınlatma ve 0° normal gözlem geometrisine sahip taşınabilir bir spektrofotometredir.

Temel Ölçüm İlkeleri:
1. 45°:0° Optik Düzen: Numune yüzeyine 45 derecelik açıyla düşen ışık, doğrudan yansıyan parlaklık bileşenini (speküler reflektans) dedektörden uzaklaştırır. Dedektör sadece numunenin içine girip saçılan renkli ışığı (diffuse reflectance) ölçer.
2. Speküler Bileşen Hariç (SPEX): Bu geometri, insan gözünün bir boya tabakasına bakarken parlaklığı algılayıp rengi ayırt etme şekline en yakın sonuçları verir.
3. 400 - 700 nm Spektral Çözünürlük: Görünür ışık tayfı 10 nm aralıklarla taranarak 31 ayrı dalga boyunda mutlak yansıma yüzdesi (R%) matrisi elde edilir.
4. Kalibrasyon Rutini: Her ölçüm oturumu öncesinde mutlak siyah tuzak (black trap) ve sertifikalı beyaz karo (white ceramic standard tile) ile sıfırlanır.
      `,
    },
    {
      id: 'saunderson',
      category: 'Yüzey Düzeltmesi',
      title: 'Saunderson Yüzey Düzeltmesi (k1 & k2 Fresnel Katsayıları)',
      shortDesc: 'Boya filmi ile hava arasındaki kırılma indisi farkından doğan Fresnel dış yansıması ve iç yayılma yansımasını düzeltir.',
      formula: 'R_i = (R_m - k1) / (1 - k1 - k2 + k2 * R_m)\nR_m = k1 + ((1 - k1)(1 - k2) * R_i) / (1 - k2 * R_i)',
      standards: ['ISO 18314-2', 'ASTM E308'],
      content: `
Klasik Kubelka-Munk teorisi, boya filminin sonsuz derinlikte ve hava ile arayüzü bulunmayan ideal bir ortamda olduğunu varsayar. Ancak gerçek hayatta, boya tabakasının yüzeyinde parlaklık ve iç yansımalar oluşur:

1. Dış Fresnel Yansıması (k1 ~ 0.04): Işık havadan boya tabakasına (kırılma indisi n ~ 1.5) geçerken yaklaşık %4'ü doğrudan yüzeyden yansır.
2. İç Yayılma Yansıması (k2 ~ 0.40 - 0.60): Pigment taneciklerinden saçılan ışık tekrar havaya çıkmaya çalışırken, kritik açıyı aşan ışınlar boya filminin içine geri yansır.
3. İç Reflektans (R_i): Saunderson düzeltmesi ile ölçülen dış reflektans (R_m), gerçek boya içindeki saf pigment etkileşimini temsil eden iç reflektansa (R_i) dönüştürülür. Bu düzeltme yapılmazsa K/S matrisleri konsantrasyonla doğrusal olmaz.
      `,
    },
    {
      id: 'kubelkamunk',
      category: 'Renk Karakterizasyonu',
      title: 'Kubelka-Munk Teorisi (Tek Sabitli ve Çift Sabitli Model)',
      shortDesc: 'Pigmentlerin ışığı soğurma (K) ve saçma (S) özelliklerini konsantrasyona bağlayan modern CCM matematik motoru.',
      formula: 'Tek Sabitli: K/S = (1 - R_inf)^2 / (2 * R_inf)\nÇift Sabitli: a = 1 + K/S, b = sqrt(a^2 - 1), R = [1 - Rg(a - b*coth(bSx))] / [a + b*coth(bSx) - Rg]',
      standards: ['ISO 18314-1', 'ASTM D2805'],
      content: `
1931 yılında Paul Kubelka ve Franz Munk tarafından geliştirilen bu teori, endüstriyel renklendirme sistemlerinin temel taşıdır:

1. Tek Sabitli Model (Single-Constant K/S): Opak beyaz baz boyalarda (Base A) saçılmayı tamamen beyaz pigment (TiO2) üstlendiği için saçılma katsayısı S sabit kabul edilir. Karışımın K/S değeri her bir pastanın konsantrasyonuyla doğrusal olarak toplanır: (K/S)_mix = (K/S)_baz + Σ (c_i * (K/S)_i).
2. Çift Sabitli Model (Two-Constant K, S): Şeffaf bazlarda (vernik/ahşap cilaları) ve derin bazlarda (Base C, D) pigmentlerin kendi saçılmaları (S_i) ihmal edilemez. Her dalga boyunda hem soğurma katsayısı K(λ) hem de saçılma katsayısı S(λ) en küçük kareler optimizasyonuyla ayrı ayrı türetilir.
3. Geri Tahmin Doğrulaması (Back-Prediction): Türetilen matris, seyreltme serisi ölçümleri üzerinde geriye dönük çalıştırılarak ΔE00 < 0.3 eşiğini sağlamalıdır.
      `,
    },
    {
      id: 'ciede2000',
      category: 'Kolorimetri',
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
      category: 'Uygulama Hataları',
      title: 'Metamerizm & Metamerizm İndeksi (MI)',
      shortDesc: 'Gün ışığında birebir aynı görünen iki rengin, mağaza veya akkor lamba altında farklı renklere dönüşmesi olgusu.',
      formula: 'MI(A) = |ΔE00(Illuminant A) - ΔE00(D65)|\nMI(F11) = |ΔE00(TL84 / F11) - ΔE00(D65)|',
      standards: ['ASTM E805', 'DIN 6172'],
      content: `
Metamerizm, boya ve otomotiv sektöründe en sık karşılaşılan müşteri şikayetlerinin başındadır:

1. Neden Oluşur?: Hedef numunenin formülasyonunda kullanılan pigmentler ile CCM laboratuvarında kullanılan pigmentlerin spektral yansıma eğrileri örtüşmediğinde metamerizm meydana gelir.
2. Çoklu Aydınlatıcı Denetimi:
   - D65 (Günışığı)
   - Illuminant A (2856 K Akkor / Tungsten Lamba)
   - F11 / TL84 (4000 K Mağaza Floresanı)
   - F2 (Soğuk Beyaz Floresan)
3. Değerlendirme Kriteri: MI < 0.5 ise metamerizm algılanamaz. MI > 1.0 ise reçete revize edilmeli ve benzer yansıma pikine sahip pigmentler seçilmelidir.
      `,
    },
    {
      id: 'flocculation',
      category: 'Boya Fiziği',
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
    {
      id: 'contrastratio',
      category: 'Örtücülük',
      title: 'Kontrast Oranı & %98 Opasite Denetimi (Hiding Power)',
      shortDesc: 'Boya filminin altındaki siyah ve beyaz zemini tamamen kapatabilme yeteneğinin fotometrik ölçümü.',
      formula: 'CR = (R_siyah / R_beyaz) * 100% >= 98.0%',
      standards: ['ISO 2814', 'ASTM D2805', 'DIN 53778'],
      content: `
Boya ve kaplama standartlarında bir kaplamanın 'Tam Örtücü' sayılabilmesi için kontrast oranının (CR) en az %98.0 olması şarttır:

1. Ölçüm Protokolü: Boya, siyah ve beyaz satranç desenli Leneta kontrol kartına standart film aplikatörü ile uygulanır.
2. Yansıma Oranı: Siyah zemin üzerindeki reflektans (R_b) ile beyaz zemin üzerindeki reflektans (R_w) oranlanır.
3. Baz Sınıflandırması:
   - Base A (Opak Beyaz): Yüksek TiO2 içerir, CR ≥ %98.0.
   - Base B (Orta): Düşük TiO2, CR ~ %90 - 95.
   - Base C (Derin): Çok az TiO2, koyu renkler için, CR ~ %65 - 80.
   - Base D (Şeffaf): TiO2 içermez, tam şeffaf cila bazı, CR < %30.
      `,
    },
  ];

  const filteredTerms = terms.filter(
    (t) =>
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.shortDesc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            X-Rite RM400, Saunderson düzeltmesi, Kubelka-Munk matrisi, CIEDE2000 ve metamerizm kılavuzu
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Terim veya formül ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-zinc-800 rounded-md text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
        </div>
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 uppercase tracking-wider">
                      {term.category}
                    </span>
                    {term.standards && term.standards.map((std, i) => (
                      <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500">
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
                        Matematiksel Formülasyon:
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
      </div>
    </div>
  );
};
