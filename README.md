# TintMatch PRO 🧪

[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Coverage](https://img.shields.io/badge/Test%20Coverage-90%25-brightgreen)](backend/tests/)
[![Standard](https://img.shields.io/badge/Standard-ISO%2018314%20%7C%20CIEDE2000-blue)](https://www.iso.org/standard/66597.html)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

> **B2B Spektrofotometrik Renklendirici Pasta ve Baz Karakterizasyonu & Bilgisayarlı Renk Eşleme (CCM - Computer Color Matching) Web Uygulaması**

**TintMatch PRO**, boya, kaplama, otomotiv ve mürekkep sanayiine yönelik olarak tasarlanmış; **X-Rite RM400** spektrofotometre ham veri entegrasyonuna sahip, **Saunderson yüzey düzeltmesi** ile **Çift Sabitli Kubelka-Munk** modelini çalıştıran, $\Delta E_{00} < 0.30$ doğrulama eşiğiyle çalışan ve canlı reçete simülasyonu sunan profesyonel bir endüstriyel laboratuvar platformudur.

---

## 🔬 Bilimsel ve Matematiksel Çekirdek

### 1. Spektral Çözünürlük ve Optik Geometri
- **Ölçüm Aralığı:** 400 nm – 700 nm, 10 nm çözünürlük (**31 spektral kanal**).
- **Cihaz Geometrisi:** X-Rite RM400 (45°:0° dairesel aydınlatma, Speküler bileşen hariç — SPEX).
- **Kolorimetri Standardı:** CIE D65 Aydınlatıcı (6504 K Günışığı) & CIE 1964 10° Ek Standart Gözlemci (ASTM E308 / ISO 18314).

### 2. Saunderson Yüzey Yansıma Düzeltmesi
Hava ile boya filmi ($n \approx 1.5$) arasındaki kırılma indisi farkından kaynaklanan dış Fresnel yansımasını ve iç yayılma yansımasını ayrıştırarak gerçek pigment etkileşimini temsil eden iç reflektansı ($R_i$) türetir:
$$R_i(\lambda) = \frac{R_m(\lambda) - k_1}{1 - k_1 - k_2 + k_2 R_m(\lambda)}$$

Ters Saunderson dönüşümü ile iç reflektanstan ölçülebilir yüzey yansıması ($R_m$) hesaplanır:
$$R_m(\lambda) = k_1 + \frac{(1 - k_1)(1 - k_2) R_i(\lambda)}{1 - k_2 R_i(\lambda)}$$

*Varsayılan Fresnel Katsayıları:* $k_1 = 0.040$ (Dış Yüzey Yansıması), $k_2 = 0.600$ (İç Yayılma Yansıması).

### 3. Çift Sabitli Kubelka-Munk Modeli (Two-Constant K-M)
Her dalga boyunda pigmentlerin soğurma katsayısı $K(\lambda)$ ve saçılma katsayısı $S(\lambda)$ ayrı ayrı optimize edilir:
$$a(\lambda) = 1 + \frac{K(\lambda)}{S(\lambda)}, \quad b(\lambda) = \sqrt{a(\lambda)^2 - 1}$$
$$R(K, S, x, R_g) = \frac{1 - R_g [a - b \coth(b S x)]}{a + b \coth(b S x) - R_g}$$

Şeffaf limit durumunda ($S \to 0$), model otomatik ve süreklilikle **Beer-Lambert** yasasına ($R = R_g e^{-2 K x}$) geçer.

### 4. Geri Tahmin Doğrulaması (Back-Prediction) & $\Delta E_{00} < 0.30$
Seyreltme serisi (%0.1, %0.5, %1, %2.5, %5, %10) ölçümleri üzerinden türetilen $K(\lambda)$ ve $S(\lambda)$ matrisleri, model tarafından geriye dönük çalıştırılarak CIEDE2000 renk farkı hesaplanır:
$$\Delta E_{00} < 0.30 \implies \textbf{ONAYLANDI (PASS - ISO 18314 Sertifikalı)}$$

### 5. Metamerizm İndeksi (MI)
Formülasyonun günışığı dışındaki aydınlatıcılar altında renk değiştirme riski çoklu aydınlatıcı matrisi ile anlık denetlenir:
$$MI(A) = |\Delta E_{00}(\text{Illuminant A}) - \Delta E_{00}(\text{D65})|$$
$$MI(F11) = |\Delta E_{00}(\text{TL84 / F11}) - \Delta E_{00}(\text{D65})|$$

### 6. Kontrast Oranı & %98 Opasite Denetimi
Leneta kartı üzerinde siyah zemin ($R_g=0.04$) ve beyaz zemin ($R_g=0.82$) fotometrik yansımaları oranlanarak örtücülük denetlenir:
$$CR = \frac{Y_{\text{siyah}}}{Y_{\text{beyaz}}} \times 100\% \ge 98.0\% \implies \textbf{Tam Örtücü Baz (Base A)}$$

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
2. **X-Rite RM400 Karakterizasyon Sihirbazı:**
   - 4 Adımlı akış: RM400 Veri Yükleme $\rightarrow$ Baz Boya Tanımlama $\rightarrow$ Seyreltme Serisi $\rightarrow$ Çift Sabitli K-M Çözümleme.
   - Dahili endüstriyel veri setleri (Phthalo Green PG7, Iron Oxide Red PR101, Phthalo Blue PB15:3).
   - Geri tahmin artık değer (residuals) tablosu ve otomatik kalite onayı.
3. **Canlı Reçete Simülatörü & Auto-Match CCM 2.0:**
   - Pasta oranlarını değiştiren ince kaydırıcılar (sliders) ve canlı renk kutucuğu.
   - **Auto-Match CCM 2.0:** Hedef spektruma göre SLSQP kısıt motoruyla $\sum c_i \le \text{max\_total\_load}$ şartını kesin olarak sağlayan, 3 bağımsız optimizasyon profili türeten motor:
     - **Reçete A (Color Match):** En yüksek D65 günışığı kolorimetrik uyumu ($\Delta E_{00} \le 0.50$).
     - **Reçete B (Light Stability):** DIN 6172 / ASTM E805 bileşik metamerizm ($MI_{\text{composite}}$) ceza ağırlıklı formülasyon.
     - **Reçete C (Economy / Low Load):** Toplam pigment yükünü minimize eden formülasyon.
   - **What-If Pigment Duyarlılık Matrisi:** Her pigment için $\frac{\partial \Delta E_{00}}{\partial c}, \frac{\partial L^*}{\partial c}, \frac{\partial a^*}{\partial c}, \frac{\partial b^*}{\partial c}$ kısmi türevleri ve formülatör tavsiyeleri.
   - **SLSQP Çözücü Teşhisi:** `OPTIMAL_CONVERGED`, kütle marjı, SHA-256 hesaplama hash izlenebilirliği.
4. **ISO 18314 Onay Sertifikası & Dışa Aktarım:**
   - ISO 18314-1/2 hesaplama metodolojisine uygunluk doğrulama raporu, yazıcı/PDF çıktısı ve 31-kanal birim $K(\lambda), S(\lambda), (K/S)(\lambda)$ matrisini CSV olarak indirme.
5. **Renk Bilimi & Spektrofotometri Sözlüğü:**
   - X-Rite RM400, Saunderson düzeltmesi, Kubelka-Munk, CIEDE2000, Metamerizm, Flokülasyon ve Rub-Out testleri teknik kılavuzu.

---

## 🏗️ Sistem Mimarisi

```
TintMatch PRO
├── backend/
│   ├── color_engine/           # Bilimsel renk motoru
│   │   ├── constants.py        # 31 kanal (400-700 nm), CIE 10°/2°, D65, A, F11, F2 SPDs
│   │   ├── profiles.py         # ColorScienceProfile & OptimizationProfile (A/B/C)
│   │   ├── quality_gate.py     # Policy-Driven Quality Gate & Yönsel artıklar
│   │   ├── saunderson.py       # Fresnel yüzey düzeltmesi ve ters dönüşüm
│   │   ├── kubelka_munk.py     # Çift ve tek sabitli K-M optimizasyonu, kontrast oranı
│   │   ├── colorimetry.py      # XYZ, CIE L*a*b*, sRGB hex, CIEDE2000, Metamerizm İndeksi
│   │   ├── formulation.py      # CCM Engine 2.0 (SLSQP Kısıt Çözücü, 3 Profil, Duyarlılık Matrisi)
│   │   └── rm400_parser.py     # PCHIP Normalizasyon, X-Rite RM400 CSV/TXT/XML parser
│   ├── database/               # SQLite veritabanı katmanı
│   │   └── db.py               # Instruments, Measurements, Recipes (SHA-256 hash) ve Şema
│   ├── routes/                 # FastAPI REST API yönlendiricileri
│   │   ├── bases.py            # Baz boya yönetimi ve opasite denetimi
│   │   ├── pastes.py           # Renklendirici pasta kütüphanesi
│   │   ├── characterization.py # RM400 içe aktarım ve K-M matris türetimi
│   │   ├── formulation.py      # Canlı reçete simülasyonu, 3-profil CCM eşleme ve profiller
│   │   └── reports.py          # ISO 18314 metodolojik uygunluk raporu ve CSV dışa aktarımı
│   ├── tests/                  # Pytest kapsamlı test paketi (52 test, %88 Kapsam)
│   │   ├── data/
│   │   │   └── regression_targets.json # Set C Deterministik 10 hedef spektrum
│   │   ├── test_api_endpoints.py
│   │   ├── test_color_engine.py
│   │   ├── test_characterization_coverage.py
│   │   ├── test_matching_coverage.py
│   │   └── test_deterministic_regression.py # 10^-4 hassasiyetli regresyon testi
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

## 🧪 Test Kapsamı (Test Coverage: %90)

Tüm renk bilimi algoritmaları, sınır koşulları, parser değişkenleri ve API uç noktaları için yazılmış **47 kapsamlı test** bulunmaktadır:

```bash
python -m pytest --cov=backend/color_engine --cov=backend/routes --cov-report=term-missing
### 7. X-Rite RM400 Yerel 64-Bit Donanım Sürücüsü & Spektral Normalizasyon
- **Doğrudan DLL Entegrasyonu:** 64-bit Python `ctypes.WinDLL` köprüsü ile `RM400.dll` doğrudan yüklenir (`Connect`, `Measure`, `GetSpectralData`, `GetCalStatus`). Harici 32-bit IPC ara katmanına gerek kalmaz.
- **Monotonik PCHIP Spektral Normalizasyon:** Gelen tüm spektral ölçümler (380-730 nm, 5 nm, 20 nm serileri) `spectrum_normalizer.py` üzerinden fiziksel $[0.0, 1.0]$ sınırlarında enterpole edilir. Sessiz kırpma (`r[:31]`) tamamen kaldırılmıştır.
- **İkili Quality Gate Mimarisi:**
  - `evaluate_characterization_gate`: RMSE $\le 0.015$, $R^2 \ge 0.995$, max residual $\le 0.035$, letdown serisi $\ge 3$, koşul indeksi (condition number).
  - `evaluate_formulation_gate`: D65 $\Delta E_{00}$, yönsel kalıntılar ($\Delta L^*, \Delta a^*, \Delta b^*, \Delta C^*, \Delta H^*$), DIN 6172 bileşik metamerizm, kütle marjı (slack $\ge 0$), SLSQP yakınsama durumu.
- **Kanonik SHA-256 Reçete İzi & Deneme Geçmişi:** Reçetenin tüm optik parametreleri (baz K/S, Saunderson $k_1/k_2$, profil, aydınlatıcı) deterministik hashlenir ve `recipe_history` tablosunda laborant denemeleri adım adım arşivlenir.

---

## 🧪 Kapsamlı Otomasyon Testleri (Test Suite)

```bash
python -m pytest --cov=backend.color_engine --cov=backend.routes --cov=backend.devices
```

```text
Name                                          Stmts   Miss  Cover
-----------------------------------------------------------------
backend\color_engine\__init__.py                  6      0   100%
backend\color_engine\colorimetry.py             126      1    99%
backend\color_engine\constants.py                16      0   100%
backend\color_engine\formulation.py             228     36    84%
backend\color_engine\kubelka_munk.py            157      7    96%
backend\color_engine\profiles.py                 57      0   100%
backend\color_engine\quality_gate.py             44      1    98%
backend\color_engine\rm400_parser.py            211     27    87%
backend\color_engine\saunderson.py               31      1    97%
backend\color_engine\spectrum_normalizer.py      25      2    92%
backend\devices\rm400_driver.py                 140     60    57%
backend\routes\__init__.py                        0      0   100%
backend\routes\bases.py                          76     41    46%
backend\routes\characterization.py              121     12    90%
backend\routes\formulation.py                   199      5    97%
backend\routes\instruments.py                    50     10    80%
backend\routes\pastes.py                         42     12    71%
backend\routes\reports.py                        52      2    96%
-----------------------------------------------------------------
TOTAL                                          1581    217    86%
============================= 65 passed in 10.33s =============================
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
