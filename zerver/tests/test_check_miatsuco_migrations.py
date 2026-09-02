from io import StringIO
from types import SimpleNamespace
from typing import Any
from unittest import mock

from django.core.management import call_command

from zerver.lib.test_classes import ZulipTestCase


class FakeMigrationGraph:
    """Minimal stand-in for django.db.migrations.graph.MigrationGraph.

    Only exposes what check_miatsuco_migrations actually reads, which
    is nodes (iterated for its keys) and node_map (key -> object with
    parents).
    """

    def __init__(self, parents_by_key: dict[tuple[str, str], set[tuple[str, str]]]) -> None:
        self.nodes: dict[tuple[str, str], Any] = dict.fromkeys(parents_by_key)
        self.node_map = {
            key: SimpleNamespace(parents=parents) for key, parents in parents_by_key.items()
        }


class CheckMiatsucoMigrationsTest(ZulipTestCase):
    COMMAND_NAME = "check_miatsuco_migrations"

    def test_real_migration_graph_is_correctly_chained(self) -> None:
        out = StringIO()
        call_command(self.COMMAND_NAME, stdout=out)
        self.assertIn("OK:", out.getvalue())
        self.assertIn("correctly chained onto zerver tip", out.getvalue())

    def test_detects_violation(self) -> None:
        graph = FakeMigrationGraph(
            {
                ("zerver", "0001_initial"): set(),
                ("zerver", "0002_second"): {("zerver", "0001_initial")},
                ("zerver", "miatsuco_0001_bad"): {("zerver", "0001_initial")},
            }
        )
        out = StringIO()
        with mock.patch("django.db.migrations.loader.MigrationLoader") as mock_loader_cls:
            mock_loader_cls.return_value.graph = graph
            with self.assertRaises(SystemExit):
                call_command(self.COMMAND_NAME, stdout=out)
        output = out.getvalue()
        self.assertIn("miatsuco migration convention violations found", output)
        self.assertIn(
            "miatsuco_0001_bad: depends on zerver migration '0001_initial', "
            "but the current actual tip is '0002_second'.",
            output,
        )
        self.assertIn("Current zerver tip: 0002_second", output)

    def test_detects_migration_with_no_upstream_dependency(self) -> None:
        graph = FakeMigrationGraph(
            {
                ("zerver", "0001_initial"): set(),
                ("zerver", "miatsuco_0001_orphan"): set(),
            }
        )
        out = StringIO()
        with mock.patch("django.db.migrations.loader.MigrationLoader") as mock_loader_cls:
            mock_loader_cls.return_value.graph = graph
            with self.assertRaises(SystemExit):
                call_command(self.COMMAND_NAME, stdout=out)
        output = out.getvalue()
        self.assertIn(
            "miatsuco_0001_orphan: has no dependency on an upstream zerver "
            "migration and doesn't chain onto another miatsuco_* migration",
            output,
        )

    def test_multiple_tip_candidates(self) -> None:
        graph = FakeMigrationGraph(
            {
                ("zerver", "0001_initial"): set(),
                ("zerver", "0002_other_head"): set(),
                ("zerver", "miatsuco_0001_feature"): {("zerver", "0001_initial")},
            }
        )
        out = StringIO()
        with mock.patch("django.db.migrations.loader.MigrationLoader") as mock_loader_cls:
            mock_loader_cls.return_value.graph = graph
            with self.assertRaises(SystemExit):
                call_command(self.COMMAND_NAME, stdout=out)
        output = out.getvalue()
        self.assertIn("Could not determine a single current tip", output)

    def test_no_miatsuco_migrations(self) -> None:
        graph = FakeMigrationGraph(
            {
                ("zerver", "0001_initial"): set(),
            }
        )
        out = StringIO()
        with mock.patch("django.db.migrations.loader.MigrationLoader") as mock_loader_cls:
            mock_loader_cls.return_value.graph = graph
            call_command(self.COMMAND_NAME, stdout=out)
        self.assertIn("No miatsuco_* migrations found; nothing to check.", out.getvalue())
