import pytest

from shared.cty import build_cty_resolver, get_cty_resolver


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
