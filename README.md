# TintMatch PRO 🧪

[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/Tests-155%20passed%20%7C%2086%25%20cov-brightgreen)](backend/tests/)
[![CCM Validation](https://img.shields.io/badge/CCM%20Validation-1.0%20(12%20Pillars)-success)](#-ccm-validation-10-end-to-end-doğrulama-ve-kıyaslama-paketi)
[![Standard](https://img.shields.io/badge/Color%20Science-CIEDE2000%20%7C%20ISO%2018314%20%7C%20ISO%2017972--3-blue)](https://www.iso.org/standard/66597.html)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

> **B2B Spektrofotometrik Renklendirici Pasta ve Baz Karakterizasyonu & Bilgisayarlı Renk Eşleme (CCM - Computer Color Matching) Web Uygulaması**

**TintMatch PRO**, boya, kaplama, otomotiv ve mürekkep sanayiine yönelik olarak tasarlanmış; **CHNSpec DS-36D** (d/8° entegre küre) ve **X-Rite RM400** (45°:0°) spektrofotometre donanım entegrasyonuna sahip, **Saunderson yüzey düzeltmesi** ile **Çift Sabitli Kubelka-Munk** modelini çalıştıran, $\Delta E_{00} < 0.30$ self-fit, LOOCV $\le 0.50$ dış-örneklem doğrulama kapıları ve **CCM VALIDATION 1.0 (12 Pillar)** endüstriyel sertifikasyon paketine sahip profesyonel bir endüstriyel laboratuvar platformudur.

---

## 🔬 Bilimsel ve Matematiksel Çekirdek

### 1. Spektral Çözünürlük ve Optik Geometri
- **Ölçüm Aralığı:** 400 nm – 700 nm, 10 nm çözünürlük (**31 spektral kanal**).
- **Cihaz Geometrisi:** 
  - CHNSpec DS-36D: d/8° difüz entegre küre geometrisi (SCI speküler dahil & SCE speküler hariç).
  - X-Rite RM400: 45°:0° dairesel aydınlatma / dik algılama (SPEX).
- **Kolorimetri Standardı:** CIE D65 Aydınlatıcı (6504 K Günışığı) & CIE 1964 10° Ek Standart Gözlemci (ASTM E308 / ISO 18314).

### 2. Saunderson Yüzey Yansıma Düzeltmesi
Hava ile boya filmi ($n \approx 1.5$) arasındaki kırılma indisi farkından kaynaklanan dış Fresnel yansımasını ve iç yayılma yansımasını ayrıştırarak gerçek pigment etkileşimini temsil eden iç reflektansı ($R_i$) türetir:
$$R_i(\lambda) = \frac{R_m(\lambda) - k_1}{1 - k_1 - k_2 + k_2 R_m(\lambda)}$$

Ters Saunderson dönüşümü ile iç reflektanstan ölçülebilir yüzey yansıması ($R_m$) hesaplanır:
$$R_m(\lambda) = k_1 + \frac{(1 - k_1)(1 - k_2) R_i(\lambda)}{1 - k_2 R_i(\lambda)}$$

*Varsayılan Fresnel Katsayıları:* $k_1 = 0.040$ (Dış Yüzey Yansıması), $k_2 = 0.600$ (İç Yayılma Yansıması). Çift yönlü analitik bijeksiyon doğruluğu $\pm 10^{-6}$ olarak test edilmiştir.

### 3. Çift Sabitli Kubelka-Munk Modeli (Two-Constant K-M)
Her dalga boyunda pigmentlerin soğurma katsayısı $K(\lambda)$ ve saçılma katsayısı $S(\lambda)$ ayrı ayrı optimize edilir:
$$a(\lambda) = 1 + \frac{K(\lambda)}{S(\lambda)}, \quad b(\lambda) = \sqrt{a(\lambda)^2 - 1}$$
$$R(K, S, x, R_g) = \frac{1 - R_g [a - b \coth(b S x)]}{a + b \coth(b S x) - R_g}$$

Şeffaf limit durumunda ($S \to 0$), model otomatik ve süreklilikle **Beer-Lambert** yasasına ($R = R_g e^{-2 K x}$) geçer.

> [!NOTE]
> **Kubelka-Munk Baz Saçılma Ölçekleme Notu:** Formülasyon hesaplamalarında $S_{\text{base}}(\lambda) = 1.0$ kabulü, literatürde ve endüstriyel CCM sistemlerinde standart bir *referans ölçekleme kuralıdır* (relative optical scale convention). Bu kabul, baz boyanın mutlak fiziksel saçılmasının tam olarak $1.0$ olduğunu iddia etmez; renklendirici pastaların birim $K(\lambda)$ ve $S(\lambda)$ katsayılarının baz boyaya göreli normalize edilmiş optik ölçeğini tanımlar. Farklı baz boyalar için doğrudan ölçülen $K_{\text{base}}$ ve $S_{\text{base}}$ spektrumları desteklenmektedir.

### 4. K-M Film Kalınlığı ve Kritik Örtücülük ($x_{98}$) Kalibrasyonu
- **Kritik Örtücülük Kalınlığı ($x_{98}$):** ASTM D2805 / ISO 2814 standardına uygun olarak kontrast oranının $CR \ge 98.0\%$ seviyesine ulaştığı minimum film kalınlığını ($\mu\text{m}$) analitik olarak hesaplar.
- **Çift Alt Tabaka Kalınlık İnversiyonu:** Siyah zemin ($R_{g1} = 0.04$) ve beyaz zemin ($R_{g2} = 0.82$) üzerinde çekilen yaş/kuru filmlerin spektral reflektanslarından film kalınlığını ($x$) ve optik saçılma gücünü ($S \cdot x$) tersine çevirerek hassas kalibre eder.

### 5. Geri Tahmin (Self-Fit) & Görülmemiş Numune Tahmini (LOOCV)
Seyreltme serisi (%0.1 - %10.0) ölçümleri üzerinden türetilen $K(\lambda)$ ve $S(\lambda)$ matrisleri iki seviyeli kalite kapısından geçer:
- **Self-Fit Geri Tahmin Doğrulaması:** Modele eğitildiği konsantrasyonlar geri beslenir:
  $$\Delta E_{00} < 0.30 \implies \textbf{ONAYLANDI (PASS - ISO 18314 metodolojisine dayalı hesaplama)}$$
- **Görülmemiş Numune Tahmini (LOOCV):** $n \ge 4$ seyreltme serilerinde Leave-One-Out Cross-Validation çalıştırılarak her bir numune eğitim dışı bırakılır ve serbestlik derecesi korunarak modelin tahmin gücü test edilir:
  $$\Delta E_{00}^{\text{LOOCV}} \le 0.50 \implies \textbf{GENELLEŞTİRİLEBİLİR (Tolerans Profili Denetimi)}$$

### 6. Metamerizm İndeksi (MI)
Formülasyonun günışığı dışındaki aydınlatıcılar altında renk değiştirme riski çoklu aydınlatıcı matrisi ile anlık denetlenir:
$$MI(A) = |\Delta E_{00}(\text{Illuminant A}) - \Delta E_{00}(\text{D65})|$$
$$MI(F11) = |\Delta E_{00}(\text{TL84 / F11}) - \Delta E_{00}(\text{D65})|$$

### 7. Kontrast Oranı & %98 Opasite Denetimi
Leneta kartı üzerinde siyah zemin ($R_g=0.04$) ve beyaz zemin ($R_g=0.82$) fotometrik yansımaları oranlanarak örtücülük denetlenir:
$$CR = \frac{Y_{\text{siyah}}}{Y_{\text{beyaz}}} \times 100\% \ge 98.0\% \implies \textbf{Tam Örtücü Baz (Base A)}$$

### 8. ISO 17972-3 CxF3 Çift Yönlü Entegrasyon
- **CxF3 Parser & Serializer:** ISO 17972-3 XML standardında spektral veri alımı ve dışa aktarımı.
- **PCHIP Normalizasyon:** Standart dışı aralıklardaki (örn. 380–730 nm @ 10 nm veya 400–700 nm @ 20 nm) spektrumlar PCHIP (Piecewise Cubic Hermite Interpolating Polynomial) ile standart 31 kanala dönüştürülür.
- **Dışa Aktarım (Export):** Numunelerin geometri, konsantrasyon ve spektral eğrilerini endüstriyel CxF3 XML formatında dışa aktarma ve $10^{-5}$ doğrulukla round-trip doğrulaması.

---

## 🛡️ CCM VALIDATION 1.0 End-to-End Doğrulama ve Kıyaslama Paketi

TintMatch PRO, endüstriyel renk laboratuvarlarında matematiksel, fiziksel ve donanımsal güvenilirliği garanti altına alan **12 Doğrulama Sütunu (12 Pillars)** ile sertifikalandırılmıştır:

| Sütun | Modül / Dosya | Kapsam & Bulgular | Test Durumu |
| :--- | :--- | :--- | :---: |
| **1. Full-library SLSQP Benchmark** | `benchmark_slsqp_library.py` | $N$-boyutlu tam kütüphane optimizasyonu ile NNLS ön elemeli SLSQP karşılaştırıldı. Koyu hedeflerde tam uzay SLSQP'nin sıfır gradyanlarda yerel minimuma takılabildiği ($\Delta E_{00} = 1.243$), NNLS ön elemesinin ise global optimuma ulaştığı ($\Delta E_{00} = 0.011$) ve $3\times$ daha hızlı çalıştığı kanıtlandı. | **PASSED** (2/2) |
| **2. NNLS Candidate-Screening Ablation** | `benchmark_nnls_ablation.py` | Doğrusal NNLS, nokta çarpım (spectral correlation) ve greedy seçim algoritmaları karşılaştırıldı. Nokta çarpım yönteminin pastel tonlarda parlak sarıyı kaçırarak $\Delta E_{00} = 7.711$ hataya yol açtığı, NNLS'nin ise $\Delta E_{00} = 0.034$ ile kusursuz çalıştığı doğrulandı. Havuz boyutu $K \ge 4$ için Pareto platosuna ulaşıldığı kanıtlandı. | **PASSED** (2/2) |
| **3. Multi-start SLSQP Benchmark** | `benchmark_multistart.py` | Farklı başlangıç vektörleri ($x_{0,\text{nnls}}$, $x_{0,\text{zero}}$, $x_{0,\text{uniform}}$, perturbasyonlar) test edildi. Solver'a opsiyonel `enable_multistart` ve `num_starts` parametreleri entegre edildi. | **PASSED** (2/2) |
| **4. K-M Thickness-Scale Calibration** | `kubelka_munk.py` | ASTM D2805 / ISO 2814 uyumlu kritik örtücülük kalınlığı ($x_{98}$) ve siyah/beyaz çift alt tabaka yansımalarından film kalınlığı tersine çevirme fonksiyonları geliştirildi. Asimptotik limitler doğrulandı. | **PASSED** (5/5) |
| **5. K-M Synthetic Golden Dataset** | `synthetic_golden_dataset.json` | 15 analitik olarak sentezlenmiş altın standart hedef (pastel, doymuş, nötr, koyu, metamerik). Sıfır gürültüde ters formülasyon hatası $\Delta E_{00} \le 0.05$; $\pm 0.005$ Gauss gürültüsünde $\Delta E_{00} \le 0.30$ stabilitesi kanıtlandı. | **PASSED** (3/3) |
| **6. Real RM400 Historical Dataset** | `test_real_rm400_validation.py` | Gerçek X-Rite RM400 cihazından alınmış letdown verileri (PB15, PG7, PR101) üzerinden karakterizasyon, LOOCV ($\Delta E_{00} \le 0.50$, ortalama $\le 0.30$) ve çoklu pigment karışım re-match süreçleri doğrulandı. | **PASSED** (2/2) |
| **7. Blind Target Dataset** | `blind_targets_dataset.json` | 15 endüstriyel stres hedefi: Metamerik çiftler, ultra-pastel dozajlar, gamut dışı kütle sınırları, F11/A ışık kaynaklarında metamerizm sapması ve toprak tonları başarıyla çözüldü. | **PASSED** (4/4) |
| **8. CxF3 Semantic Parser & Serializer** | `cxf_parser.py` | ISO 17972-3 XML standardına tam uyumlu ayrıştırıcı ve dışa aktarıcı. 20 nm adım ve farklı aralıklardaki spektrumlar PCHIP ile 31 noktaya normalize edildi; %0-100 ölçek dönüşümü ve tam roundtrip ($10^{-5}$ doğruluk) doğrulandı. | **PASSED** (5/5) |
| **9. Physical R/K/S Invariant Tests** | `test_physical_invariants.py` | Yansıma sınırları ($0 \le R \le 1$), Saunderson çift yönlü bijeksiyonu ($\pm 10^{-6}$), K-M $K/S$ evirme doğruluğu, soğurucu renklendiricilerde monotonluk ($\partial R / \partial c \le 0$) ve enerji korunumu doğrulandı. | **PASSED** (6/6) |
| **10. Reproducibility & Canonical Hashes** | `hashing.py` | Girdi permütasyonundan bağımsız (sıralama invariant) kanonik SHA-256 hash hesaplayıcı. Ardışık çalıştırmalarda bit düzeyinde ($10^{-9}$) tekrarlanabilirlik ve çok iş parçacıklı eşzamanlılık kararlılığı kanıtlandı. | **PASSED** (3/3) |
| **11. Constraint-Aware Sensitivity Tests** | `test_constraint_aware_sensitivity.py` | `ConstraintEngine 2.0` stres koşullarında test edildi: Aşırı talepte sert kütle tavanı ($\le 10.0\%$), grup üst sınırı (örn. Sarı $\le 2.0\%$), minimum dozaj eşiği altındaki mikro damlaların budanması ve sınır noktalarında gradyan sürekliliği doğrulandı. | **PASSED** (5/5) |
| **12. Instrument Calibration Hard-Gate** | `instruments.py`, `chnspec_driver.py` | 8 saatlik vardiya süresi dolan veya kalibre edilmemiş cihazlarda ölçüm isteği **HTTP 428 Precondition Required** ile engellendi. Acil durum denetim takibi için `force_measure=True` (`EXPIRED_FORCED`) bayrağı ve saat manipülasyonu tespit sistemi doğrulandı. | **PASSED** (5/5) |

---

## 🎨 Minimalist Endüstriyel Laboratuvar Tasarımı

TintMatch PRO, endüstriyel laboratuvar cihazlarının estetiğini yansıtan, dikkat dağıtmayan **minimalist bir karanlık tema** ile geliştirilmiştir:
- **Renk Paleti:** `#09090b` nötr kanvas, `#121215` / `#18181b` kart yüzeyleri, `border-zinc-800` ince 1px kenarlıklar.
- **Tipografi:** Yüksek okunurluğa sahip sans-serif tipografi ve spektral metrikler için monospace sayısal göstergeler.
- **Yüksek Bilgi Yoğunluğu:** Gereksiz süslemelerden arındırılmış, veri odaklı 3 sütunlu laboratuvar tezgahı düzeni.
- **Resmi Sertifika Görünümü:** ISO 18314 analitik kolorimetri raporu için minimalist İsviçre laboratuvar sertifikası formatı (`window.print()` ve CSV dışa aktarımı).

---

## 🖥️ Arayüz Modülleri

1. **Laboratuvar Çalışma Alanı (Workbench Dashboard):**
   - **Sol Panel:** Pasta ve baz kütüphanesi, anlık arama, kütle konsantrasyonu seçimi (%0.1 - %10.0).
   - **Orta Panel:** 400–700 nm spektral yansıma ($R\%$) ve $K/S$ logaritmik eğrisi arasında tek tıkla geçiş; hassas Recharts grafikleri.
   - **Sağ Panel:** CIE $L^*a^*b^*$ değerleri, sRGB dijital renk kutucuğu (swatch), D65 / A / F11 metamerizm indeksleri ve Leneta kontrast oranı.
2. **Spektrofotometre Entegrasyon & Kalibrasyon Masası:**
   - CHNSpec DS-36D (USB COM4) ve X-Rite RM400 cihaz durumu, port tarama ve canlı bağlantı.
   - Kalibrasyon sağlık paneli: Beyaz/Siyah karo kalibrasyonu, 8 saatlik vardiya sayacı ve HTTP 428 sert kapı bildirimleri.
3. **Karakterizasyon Sihirbazı & Çoklu Format İçe Aktarım:**
   - 4 Adımlı akış: Spektrofotometre / CxF3 / CSV / TXT Veri Yükleme $\rightarrow$ Baz Boya Tanımlama $\rightarrow$ Seyreltme Serisi $\rightarrow$ Çift Sabitli K-M Çözümleme.
   - Dahili endüstriyel veri setleri (Phthalo Green PG7, Iron Oxide Red PR101, Phthalo Blue PB15:3).
   - Geri tahmin artık değer (residuals) tablosu ve LOOCV kalite onayı.
4. **Canlı Reçete Simülatörü & Auto-Match CCM 2.0:**
   - Pasta oranlarını değiştiren ince kaydırıcılar (sliders) ve canlı renk kutucuğu.
   - **Auto-Match CCM 2.0:** Hedef spektruma göre SLSQP kısıt motoruyla $\sum c_i \le \text{max\_total\_load}$ şartını kesin olarak sağlayan, 3 bağımsız optimizasyon profili türeten motor:
     - **Reçete A (Color Match):** En yüksek D65 günışığı kolorimetrik uyumu ($\Delta E_{00} \le 0.50$).
     - **Reçete B (Light Stability):** DIN 6172 / ASTM E805 bileşik metamerizm ($MI_{\text{composite}}$) ceza ağırlıklı formülasyon.
     - **Reçete C (Economy / Low Load):** Toplam pigment yükünü minimize eden formülasyon.
   - **What-If Pigment Duyarlılık Matrisi:** Her pigment için $\frac{\partial \Delta E_{00}}{\partial c}, \frac{\partial L^*}{\partial c}, \frac{\partial a^*}{\partial c}, \frac{\partial b^*}{\partial c}$ kısmi türevleri ve formülatör tavsiyeleri.
   - **SLSQP Çözücü Teşhisi:** `OPTIMAL_CONVERGED`, kütle marjı, multi-start durumu, SHA-256 hesaplama hash izlenebilirliği.
5. **ISO 18314 Onay Sertifikası & CxF3 Dışa Aktarım:**
   - ISO 18314-1/2 hesaplama metodolojisine uygunluk doğrulama raporu, yazıcı/PDF çıktısı, 31-kanal birim $K(\lambda), S(\lambda), (K/S)(\lambda)$ CSV ve ISO 17972-3 CxF3 XML dışa aktarımı.
6. **Renk Bilimi & Spektrofotometri Sözlüğü:**
   - X-Rite RM400, CHNSpec DS-36D, Saunderson düzeltmesi, Kubelka-Munk, CIEDE2000, Metamerizm, Flokülasyon ve Rub-Out testleri teknik kılavuzu.

---

## 🏗️ Sistem Mimarisi

```
TintMatch PRO
├── backend/
│   ├── color_engine/           # Bilimsel ve matematiksel renk motoru
│   │   ├── benchmarks/         # Benchmark & ablasyon test araçları
│   │   │   ├── benchmark_slsqp_library.py  # Tam kütüphane vs Screened SLSQP
│   │   │   ├── benchmark_nnls_ablation.py  # Aday eleme ablasyonu
│   │   │   └── benchmark_multistart.py     # Multi-start yerel minimum araştırması
│   │   ├── constants.py        # 31 kanal (400-700 nm), CIE 10°/2°, D65, A, F11, F2 SPDs
│   │   ├── profiles.py         # ColorScienceProfile & OptimizationProfile (A/B/C)
│   │   ├── quality_gate.py     # Policy-Driven Quality Gate & Yönsel artıklar
│   │   ├── saunderson.py       # Fresnel yüzey düzeltmesi ve ters analitik bijeksiyon
│   │   ├── kubelka_munk.py     # Çift ve tek sabitli K-M, kontrast oranı, x_98 kalınlık
│   │   ├── colorimetry.py      # XYZ, CIE L*a*b*, sRGB hex, CIEDE2000, Metamerizm İndeksi
│   │   ├── formulation.py      # CCM Engine 2.0 (SLSQP, Multi-Start, Duyarlılık Matrisi)
│   │   ├── constraints.py      # ConstraintEngine 2.0 (Kütle tavanı, gruplar, dozaj eşiği)
│   │   ├── cxf_parser.py       # ISO 17972-3 CxF3 XML parser, serializer & PCHIP
│   │   ├── hashing.py          # Kanonik permütasyon-bağımsız SHA-256 hash motoru
│   │   ├── instrument_comparison.py # Optik geometri ayrımı & cihaz karşılaştırma
│   │   ├── spectrum_normalizer.py   # Kesin ekstrapolasyon bariyeri & grid normalizasyonu
│   │   └── rm400_parser.py     # X-Rite RM400 CSV/TXT/XML parser
│   ├── database/               # SQLite veritabanı katmanı
│   │   └── db.py               # Instruments, Measurements, Recipes (SHA-256 hash) ve Şema
│   ├── devices/                # Spektrofotometre donanım sürücüleri
│   │   ├── chnspec_driver.py   # CHNSpec DS-36D (clr / ConnectedMeasure.dll, d/8° SCI/SCE)
│   │   └── rm400_driver.py     # X-Rite RM400 (ctypes / RM400.dll, 45°:0°)
│   ├── routes/                 # FastAPI REST API yönlendiricileri
│   │   ├── bases.py            # Baz boya yönetimi ve opasite denetimi
│   │   ├── pastes.py           # Renklendirici pasta kütüphanesi
│   │   ├── characterization.py # Karakterizasyon, CxF3/RM400 içe aktarım ve K-M matris türetimi
│   │   ├── formulation.py      # Canlı reçete simülasyonu, 3-profil CCM eşleme ve duyarlılık
│   │   ├── instruments.py      # Cihaz bağlantı, ölçüm, kalibrasyon sert kapısı (HTTP 428)
│   │   └── reports.py          # ISO 18314 metodolojik uygunluk raporu ve CSV/CxF3 dışa aktarımı
│   ├── tests/                  # Pytest kapsamlı test paketi (147 test, %86 Kapsam)
│   │   ├── data/
│   │   │   ├── synthetic_golden_dataset.json # 15 Altın standart hedef
│   │   │   ├── blind_targets_dataset.json    # 15 Endüstriyel stres hedefi
│   │   │   └── real_rm400_dataset/           # PB15 CxF3, PG7 CSV, PR101 TXT
│   │   ├── test_benchmark_full_library.py    # Pillar 1
│   │   ├── test_nnls_ablation.py             # Pillar 2
│   │   ├── test_multistart_slsqp.py          # Pillar 3
│   │   ├── test_km_thickness_calibration.py  # Pillar 4
│   │   ├── test_km_synthetic_golden.py       # Pillar 5
│   │   ├── test_real_rm400_validation.py     # Pillar 6
│   │   ├── test_blind_targets.py             # Pillar 7
│   │   ├── test_cxf3_parser.py               # Pillar 8
│   │   ├── test_physical_invariants.py       # Pillar 9
│   │   ├── test_reproducibility_hashes.py    # Pillar 10
│   │   ├── test_constraint_aware_sensitivity.py # Pillar 11
│   │   ├── test_instrument_calibration_hard_gate.py # Pillar 12
│   │   ├── test_ccm_execution_pipeline_hardening.py # Negative scenario & pipeline hardening
│   │   ├── test_chnspec_driver.py
│   │   ├── test_spectrum_normalizer.py
│   │   ├── test_instrument_comparison.py
│   │   ├── test_recipe_history.py
│   │   ├── test_characterization_coverage.py
│   │   ├── test_matching_coverage.py
│   │   └── test_deterministic_regression.py
│   └── main.py                 # FastAPI v2.0.0 girişi ve statik React SPA sunumu
├── frontend/                   # React 19 + TypeScript + Vite + Tailwind CSS SPA
│   ├── src/
│   │   ├── components/         # Minimalist UI bileşenleri
│   │   │   ├── Header.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── SpectralChart.tsx
│   │   │   ├── CharacterizationWizard.tsx
│   │   │   ├── FormulationSimulator.tsx
│   │   │   ├── IsoReportView.tsx
│   │   │   └── Glossary.tsx
│   │   ├── services/api.ts     # Tip güvenli REST API istemcisi
│   │   ├── types.ts            # TypeScript veri arayüzleri
│   │   └── App.tsx             # Ana uygulama kabuğu
│   └── dist/                   # Üretim derlemesi (backend tarafından doğrudan sunulur)
├── .gitignore
├── README.md
└── run_server.py               # Tek tıkla bağımsız başlatıcı
```

---

## 🧪 Kapsamlı Otomasyon Testleri (Test Suite: 155 Test, %86 Kapsam)

```bash
python -m pytest --cov=backend.color_engine --cov=backend.routes --cov=backend.devices backend/tests/
```

```text
Name                                                         Stmts   Miss  Cover
--------------------------------------------------------------------------------
backend\color_engine\__init__.py                                 6      0   100%
backend\color_engine\addback.py                                130      3    98%
backend\color_engine\benchmarks\__init__.py                      0      0   100%
backend\color_engine\benchmarks\benchmark_multistart.py         17      0   100%
backend\color_engine\benchmarks\benchmark_nnls_ablation.py      67      2    97%
backend\color_engine\benchmarks\benchmark_slsqp_library.py      72      0   100%
backend\color_engine\colorimetry.py                            135      1    99%
backend\color_engine\constants.py                               16      0   100%
backend\color_engine\constraints.py                             71      4    94%
backend\color_engine\cxf_parser.py                             128     20    84%
backend\color_engine\formulation.py                            295     22    93%
backend\color_engine\hashing.py                                 23      0   100%
backend\color_engine\instrument_comparison.py                   64      5    92%
backend\color_engine\kubelka_munk.py                           294     18    94%
backend\color_engine\profiles.py                                75      0   100%
backend\color_engine\quality_gate.py                            89     13    85%
backend\color_engine\rm400_parser.py                           218     54    75%
backend\color_engine\saunderson.py                              31      1    97%
backend\color_engine\spectrum_normalizer.py                     72      4    94%
backend\devices\chnspec_driver.py                              339     85    75%
backend\devices\rm400_driver.py                                211     90    57%
backend\routes\__init__.py                                       0      0   100%
backend\routes\bases.py                                         76     41    46%
backend\routes\characterization.py                             142      9    94%
backend\routes\formulation.py                                  271     10    96%
backend\routes\instruments.py                                  150     24    84%
backend\routes\pastes.py                                        42     12    71%
backend\routes\reports.py                                       52      2    96%
--------------------------------------------------------------------------------
TOTAL                                                         3086    420    86%
============================ 155 passed in 43.06s =============================
```

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- Python 3.11 veya üzeri
- Node.js 18+ (sadece frontend geliştirme için; üretim derlemesi `dist/` içerisinde mevcuttur)

### 1. Kurulum
```bash
git clone https://github.com/akinozturq/tintmatch-pro.git
cd tintmatch-pro

# Python sanal ortamı oluşturun ve bağımlılıkları yükleyin
python -m venv .venv
source .venv/bin/activate  # Windows için: .venv\Scripts\activate
pip install -r backend/requirements.txt  # veya: pip install fastapi uvicorn scipy numpy colour-science pytest pytest-cov
```

### 2. Uygulamayı Başlatma
Tek bir komutla hem FastAPI backend'i hem de üretim React SPA arayüzünü ayağa kaldırabilirsiniz:
```bash
python run_server.py
```

Tarayıcınızdan açın:
- **Web Arayüzü:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Swagger API Dokümantasyonu:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 3. Frontend Geliştirici Modu (Hot-Reload)
```bash
cd frontend
npm install
npm run dev
```
Geliştirici sunucusu [http://localhost:5173](http://localhost:5173) adresinde çalışır ve API isteklerini otomatik olarak `http://127.0.0.1:8000` adresine yönlendirir.

---

## 📜 Lisans

Bu proje **MIT Lisansı** kapsamında sunulmaktadır.
