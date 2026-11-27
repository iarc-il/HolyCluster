import pytest

from shared.cty import build_cty_resolver
from shared.geo import GeoException, resolve_dxcc_entity


@pytest.mark.parametrize("callsign", ["bb4ia", "be1aa"])
def test_resolve_dxcc_entity_override_uses_canonical_dxcc_metadata(monkeypatch, callsign):
    resolver = build_cty_resolver(
        [
            ["*BE", "Regional China", "318", "AS", "23", "43", "30", "-110", "8", "BE"],
            ["BY", "China", "318", "AS", "24", "44", "35", "-105", "8", "BY"],
        ]
    )
    monkeypatch.setattr("shared.geo.get_cty_resolver", lambda: resolver)

    entity = resolve_dxcc_entity(callsign, "dx")

    assert (entity.dxcc_code, entity.country, entity.continent) == (318, "China", "AS")
    assert (entity.latitude, entity.longitude, entity.cq_zone, entity.itu_zone) == (35, 105, 24, 44)
    assert entity is not resolver.get_entity_by_dxcc_code(318)


def test_resolve_dxcc_entity_override_falls_back_to_starred_prefix(monkeypatch):
    resolver = build_cty_resolver([["*BE", "Regional China", "318", "AS", "23", "43", "30", "-110", "8", "BE"]])
    monkeypatch.setattr("shared.geo.get_cty_resolver", lambda: resolver)

    entity = resolve_dxcc_entity("BB4IA", "dx")

    assert (entity.dxcc_code, entity.country, entity.continent) == (318, "China", "AS")
    assert (entity.latitude, entity.longitude) == (30, 110)
    assert resolver.resolve_entity("BE1AA").country == "Regional China"


def test_resolve_dxcc_entity_without_override_and_unknown_callsign(monkeypatch):
    resolver = build_cty_resolver([["K", "United States", "291", "NA", "5", "8", "37.60", "91.87", "5", "K"]])
    monkeypatch.setattr("shared.geo.get_cty_resolver", lambda: resolver)

    assert resolve_dxcc_entity("k1abc", "dx") is resolver.get_entity_by_dxcc_code(291)
    for callsign in ("UNKNOWN", "BB4IA"):
        with pytest.raises(GeoException) as error:
            resolve_dxcc_entity(callsign, "dx")
        assert (error.value.callsign, error.value.callsign_type, error.value.data_type) == (callsign, "dx", "dxcc_code")
