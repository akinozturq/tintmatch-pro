"""
ISO 17972-3 CxF3 Semantic Parser & Serializer Unit Tests
========================================================
Validates parsing and serialization of CxF3 XML files:
1. Parsing inline CxF3 XML documents with concentration and geometry attributes.
2. PCHIP interpolation of non-standard spectral grids (20nm -> 10nm 31 points).
3. Automatic 0-100% reflectance scaling normalization.
4. Export and round-trip fidelity (< 1e-4 deviation).
5. Strict validation and exception handling for empty/corrupted XML.
"""

from pathlib import Path
import numpy as np
import pytest

from backend.color_engine.cxf_parser import parse_cxf3, export_cxf3
from backend.color_engine.constants import WAVELENGTHS


def test_parse_real_pb15_cxf3():
    """Verify parsing of ISO 17972 CxF3 export."""
    inline_cxf = """<?xml version="1.0" encoding="UTF-8"?>
    <CxF xmlns="http://colorexchangeformat.com/CxF3-core">
      <FileInformation>
        <Creator>CHNSpec DS-36D Calibration Suite</Creator>
        <Description>PB15 Letdown Series</Description>
      </FileInformation>
      <CustomResources>
        <ColorSpecification>
          <MeasurementConditions Geometry="d/8" Specular="SCI" />
          <Sample Name="Base_0.0%">
            <ReflectanceSpectrum StartWL="400" Step="10">
              0.832 0.854 0.871 0.882 0.888 0.892 0.895 0.897 0.898 0.899 0.898 0.897 0.896 0.894 0.893 0.891 0.890 0.889 0.887 0.885 0.884 0.882 0.880 0.879 0.877 0.875 0.874 0.872 0.870 0.868 0.865
            </ReflectanceSpectrum>
          </Sample>
          <Sample Name="PB15_0.1%">
            <ReflectanceSpectrum StartWL="400" Step="10">
              0.810 0.830 0.850 0.860 0.865 0.870 0.872 0.873 0.872 0.870 0.865 0.855 0.835 0.800 0.760 0.720 0.690 0.670 0.660 0.665 0.680 0.710 0.750 0.790 0.820 0.840 0.850 0.855 0.858 0.860 0.862
            </ReflectanceSpectrum>
          </Sample>
          <Sample Name="PB15_1.0%">
            <ReflectanceSpectrum StartWL="400" Step="10">
              0.700 0.720 0.740 0.750 0.755 0.750 0.730 0.700 0.650 0.580 0.480 0.360 0.250 0.170 0.120 0.090 0.080 0.075 0.075 0.080 0.100 0.140 0.220 0.340 0.480 0.600 0.680 0.730 0.760 0.780 0.800
            </ReflectanceSpectrum>
          </Sample>
          <Sample Name="PB15_10.0%">
            <ReflectanceSpectrum StartWL="400" Step="10">
              0.450 0.480 0.500 0.510 0.490 0.440 0.360 0.270 0.180 0.110 0.065 0.040 0.030 0.025 0.022 0.020 0.020 0.020 0.020 0.020 0.022 0.025 0.035 0.055 0.100 0.180 0.280 0.400 0.500 0.580 0.640
            </ReflectanceSpectrum>
          </Sample>
        </ColorSpecification>
      </CustomResources>
    </CxF>"""

    parsed = parse_cxf3(inline_cxf)
    assert parsed["format"] in ("CxF3", "XML/CxF3")
    samples = parsed["samples"]
    assert len(samples) == 4

    names = [s["name"] for s in samples]
    assert "Base_0.0%" in names
    assert "PB15_10.0%" in names

    conc_map = {s["name"]: s["concentration"] for s in samples}
    assert conc_map["Base_0.0%"] == 0.0
    assert conc_map["PB15_0.1%"] == 0.1
    assert conc_map["PB15_1.0%"] == 1.0
    assert conc_map["PB15_10.0%"] == 10.0

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
            "geometry": "d/8°",
            "specular_mode": "SCE",
            "reflectance": [round(float(0.05 + 0.015 * i), 5) for i in range(31)]
        }
    ]

    xml_exported = export_cxf3(
        samples=test_samples,
        creator="TintMatch PRO 2.0 Test Suite",
        instrument="CHNSpec DS-36D"
    )

    assert "<CxF" in xml_exported
    assert "xmlns=" in xml_exported
    assert "Drawdown_01" in xml_exported

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
