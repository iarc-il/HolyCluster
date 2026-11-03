import unittest
from datetime import datetime, time, timezone

from pydantic import ValidationError
from sqlalchemy import CheckConstraint

from shared.db import SpotCoverageSample


class SpotCoverageSampleModelTest(unittest.TestCase):
    def sample(self, **changes):
        values = dict(
            service="external_cluster",
            direction="holy_only",
            finalized_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            window_started_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            spot_time=time(12, 30),
            observed_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
            spotter_callsign="W1AW",
            dx_callsign="4X1AA",
            frequency="14074.0",
            comment="test",
            identity_digest="abc123",
        )
        values.update(changes)
        return SpotCoverageSample.model_validate(values)

    def test_valid_sample(self):
        self.assertEqual(self.sample().direction, "holy_only")
        self.assertEqual(self.sample(direction="service_only").direction, "service_only")

    def test_invalid_scope(self):
        for changes in ({"service": ""}, {"service": "x" * 65}, {"direction": "both"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.sample(**changes)

    def test_independent_table_and_constraints(self):
        table = SpotCoverageSample.__table__
        self.assertFalse(table.foreign_keys)
        self.assertEqual(
            {constraint.name for constraint in table.constraints if isinstance(constraint, CheckConstraint)},
            {"ck_spot_coverage_samples_service", "ck_spot_coverage_samples_direction"},
        )
        index = next(iter(table.indexes))
        self.assertEqual([column.name for column in index.columns], ["service", "direction", "finalized_at"])
        unique = next(constraint for constraint in table.constraints if constraint.name == "uc_spot_coverage_samples")
        self.assertEqual(
            [column.name for column in unique.columns],
            ["service", "direction", "identity_digest", "window_started_at"],
        )


if __name__ == "__main__":
    unittest.main()
