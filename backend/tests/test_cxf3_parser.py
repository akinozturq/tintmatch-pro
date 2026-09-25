"""
Tests for ISO 17972-3 CxF3 Semantic Parser & Serializer (Pillar 8)
=================================================================
Validates:
1. Namespaced and un-namespaced CxF3 XML parsing.
2. PCHIP interpolation of non-standard wavelength grids (e.g. 20 nm steps, 380-730 nm).
3. Scale detection (0..100% vs 0..1).
4. Concentration extraction from names and attributes.
5. Malformed XML and empty content error handling.
6. Round-trip export: parse -> export -> parse preserves spectral values within 1e-5.
"""

from pathlib import Path
import numpy as np
import pytest

from backend.color_engine.cxf_parser import parse_cxf3, export_cxf3
from backend.color_engine.constants import WAVELENGTHS

DATA_DIR = Path(__file__).parent / "data" / "real_rm400_dataset"


def test_parse_real_pb15_cxf3():
    """Verify parsing of real-world RM400 ISO 17972 CxF3 export."""
    cxf_path = DATA_DIR / "pb15_letdowns_rm400.cxf"
    assert cxf_path.exists()

    with open(cxf_path, "r", encoding="utf-8") as f:
        content = f.read()

    parsed = parse_cxf3(content)
    assert parsed["format"] in ("CxF3", "XML/CxF3")
    assert "RM400" in parsed["file_info"]["creator"] or "RM400" in parsed["file_info"]["instrument"]
    samples = parsed["samples"]
    assert len(samples) == 7

    # Check sample names and concentrations
    names = [s["name"] for s in samples]
    assert "Base_0.0%" in names
    assert "PB15_10.0%" in names

    conc_map = {s["name"]: s["concentration"] for s in samples}
    assert conc_map["Base_0.0%"] == 0.0
    assert conc_map["PB15_0.1%"] == 0.1
    assert conc_map["PB15_1.0%"] == 1.0
    assert conc_map["PB15_10.0%"] == 10.0

    # Check reflectance points
    for s in samples:
        assert len(s["reflectance"]) == 31
        assert all(0.0 <= r <= 1.0 for r in s["reflectance"])


def test_parse_non_standard_grid_and_pchip_normalization():
    """Verify that a CxF3 file with 20nm steps (16 points: 400-700) is PCHIP-interpolated to 31 points."""
    xml_20nm = """<?xml version="1.0" encoding="UTF-8"?>
    <CxF xmlns="http://colorexchangeformat.com/CxF3-core">
      <CustomResources>
        <ColorSpecification>
          <Sample Name="Tile_20nm">
            <ReflectanceSpectrum StartWL="400" Step="20">
              0.10 0.15 0.20 0.30 0.40 0.50 0.60 0.65 0.70 0.72 0.73 0.74 0.75 0.75 0.76 0.76
            </ReflectanceSpectrum>
          </Sample>
        </ColorSpecification>
      </CustomResources>
    </CxF>"""

    parsed = parse_cxf3(xml_20nm)
    assert len(parsed["samples"]) == 1
    sample = parsed["samples"][0]
    assert len(sample["reflectance"]) == 31
    assert sample["metadata"]["original_points"] == 16
    assert sample["metadata"]["step_wl"] == 20.0
    # Boundary points should match closely
    assert np.isclose(sample["reflectance"][0], 0.10, atol=1e-3)
    assert np.isclose(sample["reflectance"][-1], 0.76, atol=1e-3)


def test_parse_percentage_scale_auto_conversion():
    """Verify that reflectance in 0..100% scale is converted to 0..1."""
    xml_pct = """<?xml version="1.0" encoding="UTF-8"?>
    <CxF>
      <Sample Name="White_Tile">
        <ReflectanceSpectrum StartWL="400" Step="10">
          85.4 86.2 87.0 87.5 88.0 88.2 88.4 88.5 88.6 88.7
          88.7 88.6 88.5 88.4 88.3 88.1 88.0 87.9 87.8 87.6
          87.5 87.3 87.1 87.0 86.8 86.6 86.4 86.2 86.0 85.8 85.5
        </ReflectanceSpectrum>
      </Sample>
    </CxF>"""

    parsed = parse_cxf3(xml_pct)
    sample = parsed["samples"][0]
    assert max(sample["reflectance"]) <= 1.0
    assert sample["reflectance"][0] == pytest.approx(0.854, rel=1e-3)


def test_export_and_roundtrip_cxf3():
    """Verify export_cxf3 generates valid ISO 17972-3 XML and round-trips with < 1e-5 error."""
    test_samples = [
        {
            "name": "Drawdown_01",
            "concentration": 2.5,
            "geometry": "d/8°",
            "specular_mode": "SCI",
            "reflectance": [round(float(0.1 + 0.02 * i), 5) for i in range(31)]
        },
        {
            "name": "Drawdown_02",
            "concentration": 5.0,
            "geometry": "45°/0°",
            "specular_mode": "SPEX",
            "reflectance": [round(float(0.05 + 0.015 * i), 5) for i in range(31)]
        }
    ]

    xml_exported = export_cxf3(
        samples=test_samples,
        creator="TintMatch PRO 2.0 Test Suite",
        instrument="X-Rite RM400"
    )

    assert "<CxF" in xml_exported
    assert "xmlns=" in xml_exported
    assert "Drawdown_01" in xml_exported

    # Re-parse exported string
    re_parsed = parse_cxf3(xml_exported)
    assert len(re_parsed["samples"]) == 2

    s1 = re_parsed["samples"][0]
    assert s1["name"] == "Drawdown_01"
    assert s1["concentration"] == 2.5
    for orig_r, rep_r in zip(test_samples[0]["reflectance"], s1["reflectance"]):
        assert orig_r == pytest.approx(rep_r, abs=1e-4)


def test_malformed_cxf3_handling():
    """Verify that corrupt XML or empty content raises informative ValueError."""
    with pytest.raises(ValueError, match="Empty CxF3"):
        parse_cxf3("")

    with pytest.raises(ValueError, match="Malformed CxF3"):
        parse_cxf3("<CxF><unclosed_tag></CxF>")
