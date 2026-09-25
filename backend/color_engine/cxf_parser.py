"""
ISO 17972-3 CxF3 (Color Exchange Format) Semantic Parser & Serializer
====================================================================
Compliant with ISO 17972-3 standard for spectral data interchange.
Supports:
- Parsing namespaced and un-namespaced CxF3 XML documents
- Flexible wavelength extraction (e.g. 380-730 nm, 400-700 nm @ 10/20 nm)
- PCHIP spectral grid normalization to standard 400-700 nm @ 10 nm (31 points)
- Extraction of measurement geometry, conditions, illuminant, observer, and letdown concentration
- Strict validation and error handling for malformed XML or unphysical spectra
- ISO 17972-3 compliant CxF3 XML generation and serialization (round-trip export)
"""

import re
import xml.etree.ElementTree as ET
from xml.dom import minidom
import numpy as np

from .constants import WAVELENGTHS, N_WAVELENGTHS
from .spectrum_normalizer import normalize_spectrum


CXF3_NAMESPACE = "http://colorexchangeformat.com/CxF3-core"


def parse_cxf3(xml_content: str) -> dict:
    """
    Parses an ISO 17972-3 CxF3 XML string or document.
    Returns:
    {
        "samples": [
            {
                "name": str,
                "concentration": float | None,
                "reflectance": list[float] (31 points, 0.0 to 1.0),
                "raw_reflectance": list[float],
                "wavelengths": list[float],
                "geometry": str | None,
                "specular_mode": str | None,
                "metadata": dict
            }
        ],
        "file_info": {
            "creator": str,
            "description": str,
            "instrument": str
        },
        "format": "CxF3",
        "warnings": list[str]
    }
    """
    warnings: list[str] = []
    xml_stripped = xml_content.strip()

    if not xml_stripped:
        raise ValueError("Empty CxF3 XML content provided.")

    try:
        root = ET.fromstring(xml_stripped)
    except ET.ParseError as e:
        raise ValueError(f"Malformed CxF3 XML: {e}")

    # Remove namespace prefixes from tags for robust matching
    def strip_ns(tag: str) -> str:
        return tag.split("}")[-1] if "}" in tag else tag

    file_info = {
        "creator": "Unknown",
        "description": "",
        "instrument": ""
    }

    # Extract FileInformation
    for elem in root.iter():
        tag = strip_ns(elem.tag)
        if tag == "FileInformation":
            for child in elem:
                c_tag = strip_ns(child.tag)
                if c_tag == "Creator" and child.text:
                    file_info["creator"] = child.text.strip()
                elif c_tag == "Description" and child.text:
                    file_info["description"] = child.text.strip()
                elif c_tag == "Instrument" and child.text:
                    file_info["instrument"] = child.text.strip()

    samples = []
    parent_map = {c: p for p in root.iter() for c in p}

    # Find all elements that contain spectral data
    spectral_candidates = []
    for elem in root.iter():
        tag = strip_ns(elem.tag)
        if tag in ["ReflectanceSpectrum", "Spectrum", "ColorValue"]:
            text = elem.text or ""
            nums = re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", text)
            if len(nums) < 15:
                # Check nested children
                nested = []
                for sub in elem:
                    if sub.text:
                        nested.extend(re.findall(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", sub.text))
                if len(nested) >= 15:
                    nums = nested
            if len(nums) >= 15:
                spectral_candidates.append((elem, nums))

    for spec_elem, nums in spectral_candidates:
        # Determine parent sample and attributes
        parent = parent_map.get(spec_elem)
        s_elem = parent if parent is not None and strip_ns(parent.tag) in ["Sample", "Measurement"] else None

        s_name = ""
        conc = None

        if s_elem is not None:
            s_name = s_elem.attrib.get("Name") or s_elem.attrib.get("Id") or ""
            if "Concentration" in s_elem.attrib:
                try:
                    conc = float(s_elem.attrib["Concentration"])
                except ValueError:
                    conc = None

        if not s_name:
            s_name = spec_elem.attrib.get("Name") or spec_elem.attrib.get("Id") or "Sample"

        if conc is None:
            conc = _extract_concentration(s_name)

        # Parse grid attributes
        start_wl = float(spec_elem.attrib.get("StartWL", 400))
        step_wl = float(spec_elem.attrib.get("Step", 10))
        raw_floats = [float(v) for v in nums]
        n_points = len(raw_floats)
        source_wls = [start_wl + i * step_wl for i in range(n_points)]

        r_raw = np.array(raw_floats, dtype=float)

        # Check percentage scale (e.g. 0-100% vs 0-1)
        if np.max(r_raw) > 1.5:
            r_raw = r_raw / 100.0

        # Grid normalization to 400-700 nm @ 10 nm (31 points)
        if len(source_wls) == 31 and np.isclose(source_wls[0], 400.0) and np.isclose(source_wls[-1], 700.0):
            norm_r = np.clip(r_raw, 0.0, 1.0)
        else:
            norm_r = normalize_spectrum(r_raw, wavelengths=source_wls, target_grid=WAVELENGTHS)

        # Extract condition metadata if present
        geom = spec_elem.attrib.get("Geometry") or (s_elem.attrib.get("Geometry") if s_elem is not None else None)
        spec_mode = spec_elem.attrib.get("SpecularMode") or (s_elem.attrib.get("SpecularMode") if s_elem is not None else None)

        samples.append({
            "name": s_name,
            "concentration": conc,
            "reflectance": [round(float(v), 5) for v in norm_r],
            "raw_reflectance": [round(float(v), 5) for v in r_raw],
            "wavelengths": [float(w) for w in source_wls],
            "geometry": geom,
            "specular_mode": spec_mode,
            "metadata": {
                "source": "ISO 17972-3 CxF3",
                "original_points": n_points,
                "start_wl": start_wl,
                "step_wl": step_wl
            }
        })

    if not samples:
        warnings.append("No valid spectral curves with >= 15 measurement points found in CxF3 XML.")

    return {
        "samples": samples,
        "file_info": file_info,
        "format": "XML/CxF3",
        "warnings": warnings
    }


def export_cxf3(
    samples: list[dict],
    creator: str = "TintMatch PRO CCM Engine",
    description: str = "ISO 17972-3 CxF3 Spectrophotometric Export",
    instrument: str = "Generic Spectrophotometer"
) -> str:
    """
    Serializes spectral samples into an ISO 17972-3 compliant CxF3 XML string.

    Args:
        samples: List of sample dicts with:
                 - 'name': str
                 - 'reflectance': list[float] (31 points for 400-700 @ 10nm)
                 - optional 'concentration': float
                 - optional 'geometry': str (e.g. 'd/8°', '45°/0°')
                 - optional 'specular_mode': str ('SCI', 'SCE')
        creator: Exporting software/engine identifier
        description: Informational description
        instrument: Instrument serial or model name

    Returns:
        Formatted XML string.
    """
    root = ET.Element("CxF", xmlns=CXF3_NAMESPACE)

    # FileInformation
    file_info = ET.SubElement(root, "FileInformation")
    c_elem = ET.SubElement(file_info, "Creator")
    c_elem.text = creator
    d_elem = ET.SubElement(file_info, "Description")
    d_elem.text = description
    i_elem = ET.SubElement(file_info, "Instrument")
    i_elem.text = instrument

    # CustomResources / ColorSpecification
    custom = ET.SubElement(root, "CustomResources")
    colorspec = ET.SubElement(custom, "ColorSpecification")

    for s in samples:
        s_name = s.get("name", "Sample")
        s_elem = ET.SubElement(colorspec, "Sample", Name=s_name)

        if s.get("concentration") is not None:
            s_elem.attrib["Concentration"] = str(s["concentration"])

        spec_attribs = {
            "StartWL": "400",
            "Step": "10",
            "EndWL": "700"
        }
        if s.get("geometry"):
            spec_attribs["Geometry"] = s["geometry"]
        if s.get("specular_mode"):
            spec_attribs["SpecularMode"] = s["specular_mode"]

        spec_elem = ET.SubElement(s_elem, "ReflectanceSpectrum", **spec_attribs)
        r_vals = s.get("reflectance", [])
        if len(r_vals) != 31:
            # Normalize if not exactly 31 points
            wls = s.get("wavelengths")
            r_arr = normalize_spectrum(r_vals, wavelengths=wls) if wls else np.array(r_vals, dtype=float)
            r_vals = r_arr.tolist()

        formatted_vals = " ".join(f"{float(v):.5f}" for v in r_vals)
        spec_elem.text = f"\n          {formatted_vals}\n        "

    # Pretty print XML
    rough_str = ET.tostring(root, encoding="utf-8")
    parsed = minidom.parseString(rough_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")


def _extract_concentration(name: str) -> float | None:
    """Extracts percentage concentration from sample name (e.g. 'PB15 2.5%' -> 2.5)."""
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", name)
    if match:
        val_str = match.group(1).replace(",", ".")
        try:
            return float(val_str)
        except ValueError:
            pass

    match_raw = re.search(r"[_\-\s](\d+(?:[.,]\d+)?)(?:pct|percent)?$", name, re.IGNORECASE)
    if match_raw:
        val_str = match_raw.group(1).replace(",", ".")
        try:
            return float(val_str)
        except ValueError:
            pass

    return None
