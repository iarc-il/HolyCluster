import asyncio

import pytest

from shared.cty import build_cty_resolver, ensure_cty_available, get_cty_resolver


@pytest.mark.parametrize(
    ("callsign", "expected_country", "expected_dxcc_code"),
    [
        ("KG4A", "United States", 291),
        ("KG4ORR", "United States", 291),
        ("KG4ORR/P", "United States", 291),
        ("KG4AA", "Guantanamo Bay", 105),
        ("KG4AA/P", "Guantanamo Bay", 105),
        ("KG4NE", "Guantanamo Bay", 105),
    ],
)
def test_resolve_entity_distinguishes_guantanamo_callsigns(
    callsign: str,
    expected_country: str,
    expected_dxcc_code: int,
):
    entity = get_cty_resolver().resolve_entity(callsign)

    assert entity is not None
    assert entity.country == expected_country
    assert entity.dxcc_code == expected_dxcc_code


def test_resolve_entity_prefers_exact_kg4_callsign():
    resolver = build_cty_resolver(
        [
            ["K", "United States", "291", "NA", "5", "8", "37.60", "91.87", "5.0", "K"],
            [
                "KG4",
                "Guantanamo Bay",
                "105",
                "NA",
                "8",
                "11",
                "20.00",
                "75.00",
                "5.0",
                "KG4 =KG4ORR",
            ],
        ]
    )

    entity = resolver.resolve_entity("KG4ORR")

    assert entity is not None
    assert entity.country == "Guantanamo Bay"
    assert entity.dxcc_code == 105


def test_get_entity_by_dxcc_code_uses_canonical_entity_not_starred_alias():
    resolver = build_cty_resolver(
        [
            ["*BE", "Regional China", "318", "AS", "24", "44", "30", "-110", "8", "BE"],
            ["BY", "China", "318", "AS", "24", "44", "35", "-105", "8", "BY"],
        ]
    )

    entity = resolver.get_entity_by_dxcc_code(318)

    assert entity is resolver.resolve_entity("BY1AA")
    assert entity.country == "China"
    assert (entity.continent, entity.latitude, entity.longitude) == ("AS", 35, 105)
    assert resolver.resolve_entity("BE1AA").latitude == 30
    assert resolver.get_entity_by_dxcc_code(999999) is None


def test_ensure_cty_available_without_http_client():
    assert asyncio.run(ensure_cty_available()) is get_cty_resolver()


def test_ensure_cty_available_rejects_invalid_committed_file(monkeypatch, tmp_path):
    path = tmp_path / "cty.csv"
    path.write_text("not a CTY record")
    monkeypatch.setattr("shared.cty.CTY_PATH", path)

    with pytest.raises(RuntimeError, match="Committed CTY file is unavailable"):
        asyncio.run(ensure_cty_available())
