# TintMatch PRO 🧪

[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8.3-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/Tests-202%20passed%20%7C%20100%25%20success-brightgreen)](backend/tests/)
[![CCM Industrial Engine](https://img.shields.io/badge/CCM%20Engine-2.0%20(Deterministic%20SLSQP)-success)](#-endüstriyel-ve-laboratuvar-odaklı-temel-yetenekler)
[![Hardware](https://img.shields.io/badge/Spectrophotometer-CHNSpec%20DS--36D%20(d%2F8°)-blue)](#-donanım-entegrasyonu-chnspec-ds-36d)
[![Color Science](https://img.shields.io/badge/Color%20Science-CIEDE2000%20%7C%20ISO%2018314%20%7C%20Saunderson%20K--M-blue)](https://www.iso.org/standard/66597.html)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

> **B2B Spektrofotometrik Renklendirici Karakterizasyonu & Endüstriyel Bilgisayarlı Renk Eşleme (CCM - Computer Color Matching) Platformu**

**TintMatch PRO**, boya, kaplama, masterbatch ve kimya sanayiinde laboratuvar koloristlerinin ve fabrika operatörlerinin her gün güvenle kullanabileceği; **CHNSpec DS-36D** (d/8° entegre küre) spektrofotometre donanım entegrasyonuna sahip, **Saunderson yüzey düzeltmeli Çift Sabitli Kubelka-Munk** modelini çalıştıran, **0.01 g manuel terazi hassasiyetinde** üretilebilir reçeteler sunan profesyonel bir endüstriyel renk laboratuvarı platformudur.

---

## 🎯 Endüstriyel ve Laboratuvar Odaklı Temel Yetenekler

```text
       Hedef Numune Ölçümü (CHNSpec DS-36D)
                        ↓
    Güvenlik Kapısı (Geometri, Mod & Onaylı Pasta Kontrolü)
                        ↓
     SLSQP Deterministik Çözücü (Önayarlı Optimizasyon)
                        ↓
     0.01 g Terazi Yuvarlama & Dozajlanabilir Net Tablo
                        ↓
     Fiziksel Çekim (Drawdown) & DS-36D Doğrulama
                        ↓
    ΔE₀₀ Tolerans İçi?  ── Evet ──>  [ ✓ KABUL EDİLDİ ] (Reçeteyi Arşive Kaydet)
         │
       Hayır
         ↓
  [ 🧪 Otomatik Add-Back ] ──> Tanka İlave Gram Önerisi (Yeni Karışım)
```

### 1. 0.01 g Terazi Hassasiyeti & Değişken Parti Boyutu
- Laboratuvarda **100 g deneme** boyundan, fabrikada **5000 kg tank üretimine** kadar her parti boyutu desteklenir.
- Solver çıktıları laboratuvar terazisinin hassasiyetine (**0.01 g**) analitik olarak yuvarlanır.
- Taşıyıcı baz miktarı formülasyon kuralına göre hesaplanır:
  $$W_{\text{baz}} = W_{\text{parti}} - \sum W_{\text{pasta}}$$
- Reçete tablosunda hem **Net Tartım Gramı** hem de operatörün teraziyi sıfırlamadan ardışık döküm yapabileceği **Kümülatif Tartım Gramı** gösterilir.

### 2. Bootstrap Optik Karakterizasyon Çerçevesi
- Endüstri standardı 3-aşamalı bootstrap kalibrasyon:
  1. **Aşama 1 (Bootstrap Çekirdek):** 1 Şeffaf Baz, 1 Standart Siyah Pasta ve 1 Standart Beyaz Pasta referans sistemi olarak karakterize edilir.
  2. **Aşama 2 (Renklendirici Pastalar):** Tüm diğer pastalar bu bootstrap referans üçlüsü üzerinden bağımsız olarak karakterize edilir.
  3. **Aşama 3 (Taşıyıcı Bazlar):** Tüm diğer baz boyalar (A bazı, B bazı vb.) bootstrap pastalar ile seyreltilerek optik saçılma/soğurma profilleri çıkarılır.

### 3. Önayarlı Reçete Optimizasyonu (3 Net Önayar)
Gereksiz kafa karışıklığını önlemek için tek ve odaklı bir reçete tablosu üzerinde 3 optimizasyon önayarı:
- 🎯 **En İyi Renk (Min $\Delta E_{00}$):** D65 günışığı altında hedefe en yakın kolorimetrik eşleşme.
- 💡 **Düşük Metamerizm:** D65, A (akkor flaman) ve F2/F11 (floresan) ışıkları altında renk stabilitesi.
- 💰 **En Uygun Fiyat:** Minimum pasta sayısı ve hammadde maliyeti tasarrufu.

### 4. Fiziksel Drawdown Doğrulaması & Otomatik Add-Back Motoru
- Formül hazırlandıktan sonra çekilen numune filmi (drawdown) **CHNSpec DS-36D** ile tek tıkla okunur.
- Hedef ile çekim arasındaki fark hesaplanır:
  - $\Delta E_{00} \le 0.50 \implies$ **Kabul Edildi** (Doğrulanmış Golden Batch olarak arşive kaydedilir).
  - $0.50 < \Delta E_{00} \le 1.50 \implies$ **İlave Gerekiyor (Add-Back):** Partiyi kurtarmak için tanka eklenecek ilave pasta gramajları otomatik hesaplanır.
  - $\Delta E_{00} > 1.50 \implies$ **Reddedildi:** Formül iptal edilir, operatöre uyarı verilir.

### 5. Innovatint Uyumlu Ambalaj ve Teneke Ölçekleme
- **1 L Kutu, 2.5 L Galon, 15 L Kova** gibi standart ambalaj boyutları.
- Otomatik tepe boşluğu (headspace) ve kova maliyeti hesaplama.
- Dozajlama ve ambalaj etiket çıktısı (`window.print()`).

### 6. Deterministik Çözücü & Kanonik Dual Hash İzlenebilirliği
- Aynı girdiye (hedef spektrum, baz, pasta havuzu, tolerans) her zaman **bit düzeyinde aynı reçete çıktısı**.
- Random seed veya rastlantısal optimizasyon adımları tamamen engellenmiştir.
- Her hesaplama, girdi ve çıktı için bağımsız kanonik **SHA-256 hash** ile mühürlenir.

### 7. Reçete Güven Skoru & Kalite Kapıları
- Bilimsel diagnostik operatör kararına dönüştürülür:
  - **🟢 YÜKSEK (85-100):** Karakterizasyon geçerli, ekstrapolasyon yok, dozaj tartılabilir.
  - **🟡 ORTA (65-84):** İnce ayar gerekebilir, sınır konsantrasyonlara yakın.
  - **🔴 BLOKE (< 65):** Uyumsuz geometri, reddedilmiş pasta veya tartılamaz mikro-dozaj riski.

---

## 🖥️ 4 Temel Laboratuvar Ekranı (Sadeleştirilmiş UI/UX)

TintMatch PRO arayüzü, laboratuvar koloristinin pratik iş akışına göre 4 odaklı çalışma masasında toplanmıştır:

1. **CCM Reçete Masası (`formulation`) [Varsayılan Ana Ekran]:**
   - 📷 **[CHNSpec DS-36D ile Oku]:** Tek tıkla spektrofotometreden 31 dalga boyu hedef okuma ve hedef açıklığına ($L^*$) göre baz boya otomatik önerisi.
   - **Renk Paleti & RAL/NCS Hızlı Kartelası:** Manuel renk seçimi veya hazır karteladan yükleme.
   - **Önayar Seçimi:** 🎯 En İyi Renk | 💡 Düşük Metamerizm | 💰 En Uygun Fiyat.
   - **0.01 g Üretilebilir Tartım Tablosu:** Net ve kümülatif tartım, iş emri yazdırma, panoya kopyalama.
   - **[💾 Reçeteyi Kaydet]:** Tek tıkla reçeteyi üretim arşivine aktarma.
   - **[🎚️ Manuel Sürgülere Aktar]:** Otomatik reçetedeki oranları sürgülere aktararak $\pm 0.1$ g hassas ayarlama.
   - **[📦 Kutu & Ambalaj Boyutları]:** Katlanabilir panelde 1L, 2.5L, 15L kova ölçekleri.
   - **[🧪 Drawdown & Add-Back]:** Çekim doğrulaması ve tank düzeltmesi.

2. **K-M Karakterizasyon Sihirbazı (`wizard`):**
   - 3 Aşamalı Bootstrap kalibrasyonu.
   - CxF3 XML, CSV ve spektrofotometreden ham letdown spektrumları yükleme.
   - Sunucu tarafında K/S ve Saunderson matris türetimi.
   - LOOCV (Leave-One-Out Cross-Validation) $\le 0.50$ ve Self-Fit $\le 0.30$ kalite kapısı denetimi.

3. **Laboratuvar Kütüphanesi & Kartelalar (`library`):**
   - **Pastalar & Bazlar:** K/S logaritmik spektral eğrileri, birim yoğunluklar, fiyatlar ve yeni baz ekleme.
   - **Renk Kartelaları:** Standart RAL, NCS kartelaları oluşturma, renk ekleme ve 1 tıkla CCM hedefi olarak aktarma.
   - **Kutu & Ambalaj Boyutları:** Ambalaj tanımlama, dara ve tepe boşlukları.
   - **Üretim & Reçete Arşivi:** Geçmiş formülasyon denemeleri, attempt geçmişi ve drawdown sonuçları.

4. **Spektrofotometre Yönetimi (`spectro`):**
   - CHNSpec DS-36D seri port (COM) algılama ve canlı bağlantı.
   - Siyah/Beyaz karo kalibrasyonu ve 8 saatlik vardiya sayacı denetimi (HTTP 428 kapısı).

---

## 🔬 Bilimsel ve Matematiksel Çekirdek

### Spektral Çözünürlük ve Optik Geometri
- **Ölçüm Aralığı:** 400 nm – 700 nm, 10 nm çözünürlük (**31 spektral kanal**).
- **Cihaz Geometrisi:** d/8° entegre küre geometrisi (SCI speküler dahil & SCE speküler hariç).
- **Kolorimetri Standardı:** CIE D65 Aydınlatıcı (6504 K) & CIE 1964 10° Standart Gözlemci (ASTM E308 / ISO 18314).

### Saunderson Yüzey Düzeltmesi
Fresnel dış yansıması ($k_1 = 0.040$) ve iç yayılma yansıması ($k_2 = 0.600$) ayrılarak iç reflektans ($R_i$) türetilir:
$$R_i(\lambda) = \frac{R_m(\lambda) - k_1}{1 - k_1 - k_2 + k_2 R_m(\lambda)}$$

### Çift Sabitli Kubelka-Munk Modeli (Two-Constant K-M)
$$a(\lambda) = 1 + \frac{K(\lambda)}{S(\lambda)}, \quad b(\lambda) = \sqrt{a(\lambda)^2 - 1}$$
$$R(K, S, x, R_g) = \frac{1 - R_g [a - b \coth(b S x)]}{a + b \coth(b S x) - R_g}$$
Şeffaf limit durumunda ($S \to 0$), model analitik olarak **Beer-Lambert** yasasına ($R = R_g e^{-2 K x}$) geçer.

---

## 🏗️ Sistem Mimarisi

```text
TintMatch PRO
├── backend/
│   ├── color_engine/           # Bilimsel ve endüstriyel CCM motoru
│   │   ├── addback.py          # Otomatik Add-Back / İlave pasta düzeltme motoru
│   │   ├── colorimetry.py      # CIE L*a*b*, XYZ, CIEDE2000, Metamerizm (ISO 18314-4)
│   │   ├── constants.py        # 31 kanal (400-700 nm), CIE 10°/2°, D65, A, F11, F2
│   │   ├── constraints.py      # Kütle tavanı, grup limitleri, 0.01g dojaz eşiği
│   │   ├── context_gate.py     # Geometri, mod, onaylı pasta ve kalibrasyon güvenlik kapısı
│   │   ├── cxf_parser.py       # ISO 17972-3 CxF3 XML ayrıştırıcı ve serileştirici
│   │   ├── formulation.py      # SLSQP Çözücü, 3 önayar, 0.01g yuvarlama, dual hash
│   │   ├── hashing.py          # Kanonik SHA-256 deterministik hash motoru
│   │   ├── kubelka_munk.py     # Çift ve tek sabitli K-M, kontrast oranı, x_98 kalınlık
│   │   ├── profiles.py         # Renk bilimi ve optimizasyon profilleri
│   │   ├── quality_gate.py     # Self-fit (ΔE < 0.30) ve LOOCV (ΔE ≤ 0.50) kapısı
│   │   ├── recipe_confidence.py# Reçete güven skoru (0-100) ve operatör rehberliği
│   │   ├── saunderson.py       # Fresnel yüzey düzeltmesi ve analitik bijeksiyon
│   │   ├── spectral_parser.py  # CxF3, CSV, TXT genel spektral ayrıştırıcı
│   │   └── spectrum_normalizer.py # Ekstrapolasyon bariyeri ve grid normalizasyonu
│   ├── database/               # SQLite veritabanı
│   │   └── db.py               # Şema, tablolar, attempt takibi, cascade silmeler
│   ├── devices/                # Donanım sürücüleri
│   │   └── chnspec_driver.py   # CHNSpec DS-36D d/8° SCI/SCE donanım sürücüsü
│   ├── routes/                 # FastAPI REST API yönlendiricileri
│   │   ├── bases.py            # Baz boya yönetimi
│   │   ├── characterization.py # Karakterizasyon, bootstrap kurulumu ve K-M matrisleri
│   │   ├── configuration.py    # Kutu boyutları, renk kartelaları ve toplu eşleme
│   │   ├── formulation.py      # CCM motoru, reçete geçmişi ve drawdown kayıtları
│   │   ├── instruments.py      # CHNSpec DS-36D bağlantı, kalibrasyon (HTTP 428 kapısı)
│   │   ├── pastes.py           # Renklendirici pasta kütüphanesi
│   │   └── reports.py          # CSV dışa aktarımı
│   ├── tests/                  # 202 Kapsamlı Otomasyon Testi (%100 Başarılı)
│   └── main.py                 # FastAPI uygulaması ve SPA sunumu
├── frontend/                   # React 19 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/
│   │   │   ├── FormulationSimulator/ # CCM Reçete Masası
│   │   │   │   ├── BatchTicketModal.tsx       # A4 İş Emri Yazdırma
│   │   │   │   ├── CanSizingView.tsx          # Kutu ve Ambalaj Dozajlama
│   │   │   │   ├── ConcentrationSliders.tsx   # Manuel İnce Ayar Sürgüleri
│   │   │   │   ├── DrawdownVerificationModal.tsx # Drawdown & Add-Back Modalı
│   │   │   │   ├── ManufacturableRecipeTable.tsx # 0.01g Terazi Tartım Tablosu
│   │   │   │   ├── RecipeConfidenceCard.tsx   # Reçete Güven Skoru
│   │   │   │   ├── SpectralPreview.tsx        # Spektral Eğri Karşılaştırma
│   │   │   │   └── index.tsx                  # Reçete Masası Ana Görünümü
│   │   │   ├── BootstrapCharacterizationWorkflow.tsx # 3-Aşamalı Bootstrap
│   │   │   ├── CharacterizationWizard.tsx     # Karakterizasyon Sihirbazı
│   │   │   ├── FactoryBatchHistoryTable.tsx   # Geçmiş Üretim Arşivi
│   │   │   ├── Header.tsx                     # 4 Sekmeli Laboratuvar Navigasyonu
│   │   │   ├── LibraryView.tsx                # Birleşik Kütüphane & Kartela Masası
│   │   │   └── SpectroSettingsView.tsx        # DS-36D Spektrofotometre Masası
│   │   ├── services/api.ts     # Tip güvenli REST API istemcisi
│   │   ├── types.ts            # TypeScript veri arayüzleri
│   │   └── App.tsx             # Ana uygulama kabuğu
│   └── dist/                   # Üretim derlemesi (FastAPI tarafından doğrudan sunulur)
├── .gitignore
├── README.md
└── run_server.py               # Tek tıkla bağımsız sunucu başlatıcı
```

---

## 🧪 Kapsamlı Otomasyon Testleri (202 Test, %100 Başarılı)

```bash
python -m pytest backend/tests/ -q
```

```text
........................................................................ [ 35%]
........................................................................ [ 71%]
..........................................................               [100%]
202 passed in 204.91s (0:03:24)
```

- **Bootstrap İş Akışı Testleri:** `test_bootstrap_workflow.py` (4/4 PASSED)
- **Üretilebilir Reçete & 0.01 g Terazi:** `test_manufacturable_recipes.py` (6/6 PASSED)
- **Endüstriyel Güvenilirlik & Context Gate:** `test_industrial_reliability.py` (6/6 PASSED)
- **Reçete Geçmişi & Add-Back Takibi:** `test_recipe_history.py` (3/3 PASSED)
- **Innovatint Ambalaj ve Kutu Ölçekleme:** `test_innovatint_workflow.py` (7/7 PASSED)
- **Deterministik SLSQP & Kanonik Hash:** `test_reproducibility_hashes.py` & `test_deterministic_regression.py` (8/8 PASSED)
- **Fiziksel Değişmezler & Enerji Korunumu:** `test_physical_invariants.py` (6/6 PASSED)
- **CHNSpec DS-36D Sürücü & Kalibrasyon Kapısı:** `test_chnspec_driver.py` & `test_instrument_calibration_hard_gate.py` (9/9 PASSED)
- **CxF3 XML Ayrıştırıcı & Serileştirici:** `test_cxf3_parser.py` (5/5 PASSED)
- **Tüm Test Paketi:** **202 / 202 PASSED (100% Başarılı)**

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- Python 3.11 veya üzeri
- Windows 10/11 (CHNSpec DS-36D donanım sürücüsü USB seri portu için)
- Node.js 18+ (sadece frontend geliştirme için; üretim derlemesi `frontend/dist/` içerisinde hazır olarak mevcuttur)

### 1. Kurulum
```bash
git clone https://github.com/akinozturq/tintmatch-pro.git
cd tintmatch-pro

# Python sanal ortamı oluşturun ve bağımlılıkları yükleyin
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
```

### 2. Uygulamayı Başlatma
Tek bir komutla hem FastAPI backend'i hem de derlenmiş React SPA laboratuvar arayüzünü ayağa kaldırabilirsiniz:
```bash
python run_server.py
```

Tarayıcınızdan açın:
- **Web Arayüzü:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Swagger API Dokümantasyonu:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### 3. Frontend Geliştirici Modu (Hot-Reload)
Frontend kaynak kodlarını canlı düzenlemek için:
```bash
cd frontend
npm install
npm run dev
```
Geliştirici sunucusu [http://localhost:5173](http://localhost:5173) adresinde açılır ve API çağrılarını otomatik olarak `http://127.0.0.1:8000` backend sunucusuna iletir.

---

## 📜 Lisans

Bu proje **MIT Lisansı** kapsamında sunulmaktadır.
